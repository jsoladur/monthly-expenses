import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { upsertUserOnSignIn } from "@/server/services/auth";
import {
  CannotRemoveOwnerError,
  InvalidWorkspaceNameError,
  InvalidWorkspaceRoleError,
  OwnerCannotLeaveError,
  PrivateWorkspaceImmutableError,
  WorkspaceEmailNotAllowedError,
  WorkspaceMemberExistsError,
  WorkspaceMemberNeverSignedInError,
  WorkspaceNameMismatchError,
  addMember,
  createSharedWorkspace,
  deleteWorkspace,
  ensurePrivateWorkspace,
  getWorkspaceDetails,
  leaveWorkspace,
  listMyWorkspaces,
  removeMember,
  resolveActiveWorkspaceFor,
  setWorkspaceCurrency,
} from "@/server/services/workspaces";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import { WorkspaceNotFoundError, type WorkspaceAccess } from "@/lib/workspace-roles";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createAnnual } from "@/server/services/annuals";
import { createMonth, getMonthList } from "@/server/services/months";
import { addActual, listActualsForMonth } from "@/server/services/actuals";
import { addIncome } from "@/server/services/incomes";
import { getMonthSummary } from "@/server/services/summary";
import { parseAllowlist } from "@/server/auth/allowlist";
import { seedOwnerAccess } from "./_helpers/workspace";

// ============================================================================
// UC-31 collaborative workspaces — integration (PRD UC-33, C30–C31,
// §15 scenarios 78–79, 81–82, 86–90, 93). Roles (83–85) live in
// `workspace-roles.test.ts`.
//
// Runs on the throwaway `expenses_test` database (the suite truncates
// `app_user`). Skipped when Postgres is unreachable.
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

const ALLOW = parseAllowlist(
  "owner@example.com, member@example.com, other@example.com, never@example.com",
);

suite("UC-31 workspaces", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  // -------------------------------------------------------------------------
  it("79 — first sign-in creates exactly one private workspace with an Owner membership; a second sign-in creates none", async () => {
    const first = await upsertUserOnSignIn({ googleSub: "s79", email: "owner@example.com" });
    await upsertUserOnSignIn({ googleSub: "s79", email: "owner@example.com" });
    await ensurePrivateWorkspace(first.id);

    const rows = await db.execute<{ kind: string; role: string; currency: string }>(sql`
      SELECT w.kind::text AS kind, m.role::text AS role, w.currency AS currency
      FROM workspace w JOIN workspace_member m ON m.workspace_id = w.id
      WHERE w.personal_user_id = ${first.id}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "private", role: "owner", currency: "EUR" });

    const mine = await listMyWorkspaces(first.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.kind).toBe("private");
  });

  // -------------------------------------------------------------------------
  it("81 — creating a shared workspace makes the creator its Owner and leaves the private workspace untouched", async () => {
    const owner = await seedOwnerAccess("s81", { email: "owner@example.com" });
    await createCategory(owner, { kind: "expense", name: "Food" });
    await createMonth(owner, { year: 2026, month: 11 });

    const shared = await createSharedWorkspace(owner.userId, { name: "  Home budget ", currency: "USD" });
    expect(shared.kind).toBe("shared");
    expect(shared.name).toBe("Home budget");
    expect(shared.currency).toBe("USD");

    const access = await loadWorkspaceAccess(owner.userId, shared.id);
    expect(access.role).toBe("owner");
    // Starts empty (UC-31 §4.2.3).
    expect(await getMonthList(access)).toHaveLength(0);
    // Private untouched.
    expect(await getMonthList(owner)).toHaveLength(1);

    const mine = await listMyWorkspaces(owner.userId);
    expect(mine.map((w) => w.kind)).toEqual(["private", "shared"]);

    await expect(createSharedWorkspace(owner.userId, { name: "   ", currency: "EUR" })).rejects.toBeInstanceOf(
      InvalidWorkspaceNameError,
    );
    await expect(
      createSharedWorkspace(owner.userId, { name: "x".repeat(61), currency: "EUR" }),
    ).rejects.toBeInstanceOf(InvalidWorkspaceNameError);
  });

  // -------------------------------------------------------------------------
  it("82 — adding members: allowlisted + signed in is added; not allowlisted, never signed in, duplicate and Owner role are rejected", async () => {
    const owner = await seedOwnerAccess("s82o", { email: "owner@example.com" });
    const member = await seedOwnerAccess("s82m", { email: "member@example.com" });
    await seedOwnerAccess("s82x", { email: "stranger@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);

    // Normalized like the allowlist (trim + lowercase).
    await addMember(ownerShared, { email: "  MEMBER@example.com ", role: "editor" }, ALLOW);
    const asMember = await loadWorkspaceAccess(member.userId, shared.id);
    expect(asMember.role).toBe("editor");

    const before = await countMembers(shared.id);
    await expect(
      addMember(ownerShared, { email: "stranger@example.com", role: "reader" }, ALLOW),
    ).rejects.toBeInstanceOf(WorkspaceEmailNotAllowedError);
    await expect(
      addMember(ownerShared, { email: "never@example.com", role: "reader" }, ALLOW),
    ).rejects.toBeInstanceOf(WorkspaceMemberNeverSignedInError);
    await expect(
      addMember(ownerShared, { email: "member@example.com", role: "admin" }, ALLOW),
    ).rejects.toBeInstanceOf(WorkspaceMemberExistsError);
    await expect(
      addMember(
        ownerShared,
        { email: "other@example.com", role: "owner" as unknown as "admin" },
        ALLOW,
      ),
    ).rejects.toBeInstanceOf(InvalidWorkspaceRoleError);
    expect(await countMembers(shared.id)).toBe(before);
  });

  // -------------------------------------------------------------------------
  it("86 — the Owner deletes a shared workspace behind the typed name; only its rows go; a private workspace cannot be deleted", async () => {
    const owner = await seedOwnerAccess("s86o", { email: "owner@example.com" });
    const other = await seedOwnerAccess("s86x", { email: "other@example.com" });
    await seedLedger(owner);
    await seedLedger(other);
    const shared = await createSharedWorkspace(owner.userId, { name: "Trip 2026", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);
    await seedLedger(ownerShared);
    await addMember(ownerShared, { email: "other@example.com", role: "reader" }, ALLOW);

    const privateCounts = await countTenantRows(owner.workspaceId);
    const otherCounts = await countTenantRows(other.workspaceId);

    await expect(deleteWorkspace(ownerShared, { confirmName: "Trip" })).rejects.toBeInstanceOf(
      WorkspaceNameMismatchError,
    );
    await deleteWorkspace(ownerShared, { confirmName: "  trip 2026 " });

    const goneCounts = await countTenantRows(shared.id);
    expect(goneCounts).toEqual({ months: 0, categories: 0, templates: 0, annuals: 0, incomes: 0, lines: 0, actuals: 0 });
    expect(await countMembers(shared.id)).toBe(0);
    expect(await countTenantRows(owner.workspaceId)).toEqual(privateCounts);
    expect(await countTenantRows(other.workspaceId)).toEqual(otherCounts);

    await expect(deleteWorkspace(owner, { confirmName: "x" })).rejects.toBeInstanceOf(
      PrivateWorkspaceImmutableError,
    );
  });

  // -------------------------------------------------------------------------
  it("87 — a non-member gets the same not-found answer for a real workspace id and a random one", async () => {
    const owner = await seedOwnerAccess("s87o", { email: "owner@example.com" });
    const outsider = await seedOwnerAccess("s87x", { email: "other@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Secret", currency: "EUR" });

    const real = await loadWorkspaceAccess(outsider.userId, shared.id).catch((e: unknown) => e);
    const random = await loadWorkspaceAccess(outsider.userId, randomUUID()).catch((e: unknown) => e);
    const otherPrivate = await loadWorkspaceAccess(outsider.userId, owner.workspaceId).catch(
      (e: unknown) => e,
    );
    expect(real).toBeInstanceOf(WorkspaceNotFoundError);
    expect(random).toBeInstanceOf(WorkspaceNotFoundError);
    expect(otherPrivate).toBeInstanceOf(WorkspaceNotFoundError);
    expect((real as Error).message).toBe((random as Error).message);
    // Malformed ids answer the same way (no 22P02 leak).
    await expect(loadWorkspaceAccess(outsider.userId, "not-a-uuid")).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  // -------------------------------------------------------------------------
  it("88 — the active workspace follows the cookie; a stale cookie for a workspace the user left falls back to the private one", async () => {
    const owner = await seedOwnerAccess("s88o", { email: "owner@example.com" });
    const member = await seedOwnerAccess("s88m", { email: "member@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);
    await addMember(ownerShared, { email: "member@example.com", role: "reader" }, ALLOW);

    expect((await resolveActiveWorkspaceFor(member.userId, shared.id)).workspaceId).toBe(shared.id);
    expect((await resolveActiveWorkspaceFor(member.userId, undefined)).workspaceId).toBe(member.workspaceId);
    expect((await resolveActiveWorkspaceFor(member.userId, "garbage")).workspaceId).toBe(member.workspaceId);

    const asMember = await loadWorkspaceAccess(member.userId, shared.id);
    await leaveWorkspace(asMember);
    expect((await resolveActiveWorkspaceFor(member.userId, shared.id)).workspaceId).toBe(member.workspaceId);
  });

  // -------------------------------------------------------------------------
  it("89 — the same year and month exists once per workspace; creating one never affects the other and figures never mix", async () => {
    const owner = await seedOwnerAccess("s89o", { email: "owner@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);

    const privMonth = await createMonth(owner, { year: 2026, month: 11 });
    const sharedMonth = await createMonth(ownerShared, { year: 2026, month: 11 });
    expect(privMonth.id).not.toBe(sharedMonth.id);

    const privIncome = await createCategory(owner, { kind: "income", name: "Salary" });
    const privFood = await createCategory(owner, { kind: "expense", name: "Food" });
    const sharedIncome = await createCategory(ownerShared, { kind: "income", name: "Salary" });
    const sharedFood = await createCategory(ownerShared, { kind: "expense", name: "Food" });

    await addIncome(owner, { monthId: privMonth.id, categoryId: privIncome.id, name: "Pay", amount: "1000.00" });
    await addActual(owner, { monthId: privMonth.id, categoryId: privFood.id, name: "Shop", amount: "100.00" });
    await addIncome(ownerShared, { monthId: sharedMonth.id, categoryId: sharedIncome.id, name: "Pay", amount: "3000.00" });
    await addActual(ownerShared, { monthId: sharedMonth.id, categoryId: sharedFood.id, name: "Shop", amount: "700.00" });

    const priv = await getMonthSummary(owner, privMonth.id);
    const shr = await getMonthSummary(ownerShared, sharedMonth.id);
    expect(priv.potentialSavings).toBe(90000);
    expect(shr.potentialSavings).toBe(230000);

    // A category or month of the other workspace is not found here.
    await expect(
      addActual(owner, { monthId: privMonth.id, categoryId: sharedFood.id, name: "x", amount: "1.00" }),
    ).rejects.toThrow();
    await expect(getMonthSummary(owner, sharedMonth.id)).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  it("90 — removing a member ends access on the next request; their past actuals stay, attributed to them", async () => {
    const owner = await seedOwnerAccess("s90o", { email: "owner@example.com" });
    const member = await seedOwnerAccess("s90m", { email: "member@example.com", displayName: "Marta" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);
    await addMember(ownerShared, { email: "member@example.com", role: "editor" }, ALLOW);
    const asMember = await loadWorkspaceAccess(member.userId, shared.id);

    const m = await createMonth(asMember, { year: 2026, month: 11 });
    const food = await createCategory(asMember, { kind: "expense", name: "Food" });
    const ticket = await addActual(asMember, { monthId: m.id, categoryId: food.id, name: "Shop", amount: "12.00" });
    expect(ticket.createdByUserId).toBe(member.userId);

    await expect(removeMember(ownerShared, { userId: owner.userId })).rejects.toBeInstanceOf(
      CannotRemoveOwnerError,
    );
    await removeMember(ownerShared, { userId: member.userId });

    await expect(loadWorkspaceAccess(member.userId, shared.id)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    const left = await listActualsForMonth(ownerShared, m.id);
    expect(left).toHaveLength(1);
    expect(left[0]!.createdByUserId).toBe(member.userId);

    const details = await getWorkspaceDetails(ownerShared);
    expect(details.authors[member.userId]).toBe("Marta");
  });

  // -------------------------------------------------------------------------
  it("91 — a non-owner member can leave; the Owner cannot leave while the workspace exists", async () => {
    const owner = await seedOwnerAccess("s91o", { email: "owner@example.com" });
    await seedOwnerAccess("s91m", { email: "member@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);
    const added = await addMember(ownerShared, { email: "member@example.com", role: "admin" }, ALLOW);

    await expect(leaveWorkspace(ownerShared)).rejects.toBeInstanceOf(OwnerCannotLeaveError);
    await expect(leaveWorkspace(owner)).rejects.toBeInstanceOf(PrivateWorkspaceImmutableError);

    const asMember = await loadWorkspaceAccess(added.userId, shared.id);
    await leaveWorkspace(asMember);
    await expect(loadWorkspaceAccess(added.userId, shared.id)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  // -------------------------------------------------------------------------
  it("93 — changing the currency of a shared workspace relabels only that workspace", async () => {
    const owner = await seedOwnerAccess("s93o", { email: "owner@example.com" });
    const shared = await createSharedWorkspace(owner.userId, { name: "Shared", currency: "EUR" });
    const ownerShared = await loadWorkspaceAccess(owner.userId, shared.id);

    await setWorkspaceCurrency(ownerShared, "USD");
    const mine = await listMyWorkspaces(owner.userId);
    expect(mine.find((w) => w.id === shared.id)!.currency).toBe("USD");
    expect(mine.find((w) => w.id === owner.workspaceId)!.currency).toBe("EUR");
  });
});

// ============================================================================
// 78 — migration 0008 backfill, on a scratch database built from the real
// migration files 0000–0007 (never on a real database).
// ============================================================================

suite("UC-31 migration 0008 (scratch database)", () => {
  const scratchName = `expenses_mig0008_${Date.now()}`;
  const baseUrl = process.env.DATABASE_URL ?? "postgres://expenses:expenses@db:5432/expenses";
  const admin = postgres(baseUrl, { max: 1, prepare: false });
  let scratch: postgres.Sql | null = null;

  afterAll(async () => {
    if (scratch) await scratch.end({ timeout: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName}`);
    await admin.end({ timeout: 1 });
  });

  it("78 — every existing user ends with one private workspace holding all of their rows; counts are unchanged", async () => {
    await admin.unsafe(`CREATE DATABASE ${scratchName}`);
    const url = new URL(baseUrl);
    url.pathname = `/${scratchName}`;
    scratch = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
    const s = scratch;

    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const tags = journal.entries.sort((a, b) => a.idx - b.idx).map((e) => e.tag);
    const idx0008 = tags.findIndex((t) => t.startsWith("0008_"));
    expect(idx0008).toBe(8);

    for (const tag of tags.slice(0, idx0008)) await applyMigration(s, tag);

    // Two users: one with a non-default currency, one with an inactive
    // duplicate category name.
    const [alice] = await s`INSERT INTO app_user (google_sub, email) VALUES ('a', 'a@example.com') RETURNING id`;
    const [bob] = await s`INSERT INTO app_user (google_sub, email) VALUES ('b', 'b@example.com') RETURNING id`;
    await s`INSERT INTO profile_settings (user_id, currency) VALUES (${alice!.id}, 'USD'), (${bob!.id}, 'EUR')`;
    for (const u of [alice!.id, bob!.id] as string[]) {
      const [food] = await s`INSERT INTO category (user_id, name, kind) VALUES (${u}, 'Food', 'expense') RETURNING id`;
      const [pay] = await s`INSERT INTO category (user_id, name, kind) VALUES (${u}, 'Salary', 'income') RETURNING id`;
      await s`INSERT INTO template (user_id, category_id, name, amount, kind) VALUES (${u}, ${food!.id}, 'Groceries', '400.00', 'estimated')`;
      await s`INSERT INTO annual (user_id, category_id, name, charge_month) VALUES (${u}, ${food!.id}, 'Insurance', 3)`;
      for (const mo of [10, 11]) {
        const [m] = await s`INSERT INTO month (user_id, year, month) VALUES (${u}, 2026, ${mo}) RETURNING id`;
        await s`INSERT INTO month_income (month_id, category_id, name, amount) VALUES (${m!.id}, ${pay!.id}, 'Pay', '2000.00')`;
        await s`INSERT INTO month_fixed_line (month_id, category_id, name, remaining_amount, original_amount, kind) VALUES (${m!.id}, ${food!.id}, 'Groceries', '400.00', '400.00', 'estimated')`;
        await s`INSERT INTO month_actual_expense (month_id, category_id, name, amount) VALUES (${m!.id}, ${food!.id}, 'Shop', '50.00')`;
      }
    }
    await s`INSERT INTO category (user_id, name, kind, active) VALUES (${bob!.id}, 'Food', 'expense', false)`;

    const before = await perUserCounts(s);
    await applyMigration(s, tags[idx0008]!);

    const workspaces = await s<{ personal_user_id: string; currency: string; role: string; kind: string }[]>`
      SELECT w.personal_user_id, w.currency, w.kind::text AS kind, m.role::text AS role
      FROM workspace w JOIN workspace_member m ON m.workspace_id = w.id AND m.user_id = w.personal_user_id
      ORDER BY w.personal_user_id`;
    expect(workspaces).toHaveLength(2);
    expect(workspaces.every((w) => w.kind === "private" && w.role === "owner")).toBe(true);
    expect(workspaces.find((w) => w.personal_user_id === alice!.id)!.currency).toBe("USD");

    const after = await s<{ user_id: string; t: string; n: number }[]>`
      SELECT w.personal_user_id AS user_id, x.t, x.n FROM workspace w
      CROSS JOIN LATERAL (
        SELECT 'category' AS t, count(*)::int AS n FROM category WHERE workspace_id = w.id
        UNION ALL SELECT 'template', count(*)::int FROM template WHERE workspace_id = w.id
        UNION ALL SELECT 'annual', count(*)::int FROM annual WHERE workspace_id = w.id
        UNION ALL SELECT 'month', count(*)::int FROM month WHERE workspace_id = w.id
        UNION ALL SELECT 'month_income', count(*)::int FROM month_income i JOIN month m ON m.id = i.month_id WHERE m.workspace_id = w.id
        UNION ALL SELECT 'month_fixed_line', count(*)::int FROM month_fixed_line l JOIN month m ON m.id = l.month_id WHERE m.workspace_id = w.id
        UNION ALL SELECT 'month_actual_expense', count(*)::int FROM month_actual_expense a JOIN month m ON m.id = a.month_id WHERE m.workspace_id = w.id
      ) x ORDER BY 1, 2`;
    expect(after.map((r) => ({ ...r }))).toEqual(before);

    // Actuals are attributed to their owner.
    const unattributed = await s`
      SELECT a.id FROM month_actual_expense a JOIN month m ON m.id = a.month_id
      JOIN workspace w ON w.id = m.workspace_id
      WHERE a.created_by_user_id IS DISTINCT FROM w.personal_user_id`;
    expect(unattributed).toHaveLength(0);

    // Old columns are gone; new indexes work per workspace.
    const cols = await s`SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'user_id'
        AND table_name IN ('category', 'template', 'annual', 'month')`;
    expect(cols).toHaveLength(0);
    const [aliceWs] = await s`SELECT id FROM workspace WHERE personal_user_id = ${alice!.id}`;
    await expect(
      s`INSERT INTO category (workspace_id, name, kind) VALUES (${aliceWs!.id}, 'Food', 'expense')`,
    ).rejects.toThrow(/category_active_name_uk/);
    await expect(
      s`INSERT INTO month (workspace_id, year, month) VALUES (${aliceWs!.id}, 2026, 10)`,
    ).rejects.toThrow(/month_workspace_period_uk/);
  });
});

// ============================================================================
// Helpers
// ============================================================================

async function applyMigration(s: postgres.Sql, tag: string): Promise<void> {
  const text = readFileSync(resolve(process.cwd(), `drizzle/${tag}.sql`), "utf8");
  const statements = text
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  await s.begin(async (tx) => {
    for (const st of statements) await tx.unsafe(st);
  });
}

async function perUserCounts(s: postgres.Sql) {
  const rows = await s<{ user_id: string; t: string; n: number }[]>`
    SELECT u.id AS user_id, x.t, x.n FROM app_user u
    CROSS JOIN LATERAL (
      SELECT 'category' AS t, count(*)::int AS n FROM category WHERE user_id = u.id
      UNION ALL SELECT 'template', count(*)::int FROM template WHERE user_id = u.id
      UNION ALL SELECT 'annual', count(*)::int FROM annual WHERE user_id = u.id
      UNION ALL SELECT 'month', count(*)::int FROM month WHERE user_id = u.id
      UNION ALL SELECT 'month_income', count(*)::int FROM month_income i JOIN month m ON m.id = i.month_id WHERE m.user_id = u.id
      UNION ALL SELECT 'month_fixed_line', count(*)::int FROM month_fixed_line l JOIN month m ON m.id = l.month_id WHERE m.user_id = u.id
      UNION ALL SELECT 'month_actual_expense', count(*)::int FROM month_actual_expense a JOIN month m ON m.id = a.month_id WHERE m.user_id = u.id
    ) x ORDER BY 1, 2`;
  return rows.map((r) => ({ ...r }));
}

async function seedLedger(access: WorkspaceAccess): Promise<void> {
  const food = await createCategory(access, { kind: "expense", name: "Food" });
  const pay = await createCategory(access, { kind: "income", name: "Salary" });
  await createTemplate(access, { categoryId: food.id, name: "Groceries", amount: "400.00", kind: "estimated" });
  await createAnnual(access, { categoryId: food.id, name: "Insurance", chargeMonth: 3, isDirectDebit: false });
  const m = await createMonth(access, { year: 2026, month: 11 });
  await addIncome(access, { monthId: m.id, categoryId: pay.id, name: "Pay", amount: "2000.00" });
  await addActual(access, { monthId: m.id, categoryId: food.id, name: "Shop", amount: "25.00" });
}

async function countTenantRows(workspaceId: string) {
  const [row] = await db.execute<{
    months: number;
    categories: number;
    templates: number;
    annuals: number;
    incomes: number;
    lines: number;
    actuals: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM month WHERE workspace_id = ${workspaceId}) AS months,
      (SELECT count(*)::int FROM category WHERE workspace_id = ${workspaceId}) AS categories,
      (SELECT count(*)::int FROM template WHERE workspace_id = ${workspaceId}) AS templates,
      (SELECT count(*)::int FROM annual WHERE workspace_id = ${workspaceId}) AS annuals,
      (SELECT count(*)::int FROM month_income i JOIN month m ON m.id = i.month_id WHERE m.workspace_id = ${workspaceId}) AS incomes,
      (SELECT count(*)::int FROM month_fixed_line l JOIN month m ON m.id = l.month_id WHERE m.workspace_id = ${workspaceId}) AS lines,
      (SELECT count(*)::int FROM month_actual_expense a JOIN month m ON m.id = a.month_id WHERE m.workspace_id = ${workspaceId}) AS actuals
  `);
  return { ...row! };
}

async function countMembers(workspaceId: string): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM workspace_member WHERE workspace_id = ${workspaceId}`,
  );
  return row!.n;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-31 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
