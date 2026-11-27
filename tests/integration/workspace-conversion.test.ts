import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as workspaceRepo from "@/server/repositories/workspace";
import { getProfileSettings, updateCurrency } from "@/server/repositories/profile-settings";
import {
  InvalidWorkspaceNameError,
  PrivateWorkspaceImmutableError,
  WorkspaceNameMismatchError,
  addMember,
  createSharedWorkspace,
  getActualAuthorLabels,
  resolveActiveWorkspaceFor,
  setWorkspaceCurrency,
} from "@/server/services/workspaces";
import {
  DataLossNotAcknowledgedError,
  WorkspaceAlreadySharedError,
  getMakePrivateSummary,
  getShareSummary,
  makeWorkspaceMyPrivate,
  shareMyPrivateWorkspace,
} from "@/server/services/workspace-conversion";
import { proposeOwnershipTransfer } from "@/server/services/workspace-transfer";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import {
  WorkspaceForbiddenError,
  WorkspaceNotFoundError,
  type WorkspaceAccess,
} from "@/lib/workspace-roles";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createAnnual } from "@/server/services/annuals";
import { createMonth } from "@/server/services/months";
import { addActual } from "@/server/services/actuals";
import { parseAllowlist } from "@/server/auth/allowlist";
import { seedOwnerAccess } from "./_helpers/workspace";

// ============================================================================
// UC-33 convert private ↔ shared — integration (PRD UC-35 / C33,
// §15 scenarios 104–113). Runs on the throwaway `expenses_test` database.
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

const ALLOW = parseAllowlist(
  "owner@example.com, admin@example.com, editor@example.com, reader@example.com, other@example.com, invitee@example.com",
);

/** Category + template + annual + month (with its cloned line) + one actual. */
async function seedLedger(access: WorkspaceAccess, label: string) {
  const category = await createCategory(access, { kind: "expense", name: `Food ${label}` });
  await createTemplate(access, {
    categoryId: category.id,
    name: `Rent ${label}`,
    amount: "700.00",
    kind: "committed",
  });
  await createAnnual(access, {
    categoryId: category.id,
    name: `Insurance ${label}`,
    amount: "300.00",
    chargeMonth: 3,
    isDirectDebit: true,
  });
  const month = await createMonth(access, { year: 2026, month: 11 });
  await addActual(access, { monthId: month.id, categoryId: category.id, name: "Shop", amount: "12.50" });
  return { category, month };
}

interface SharedFixture {
  owner: WorkspaceAccess;
  ownerPrivateId: string;
  admin: WorkspaceAccess;
  editor: WorkspaceAccess;
  reader: WorkspaceAccess;
  workspaceId: string;
}

async function seedShared(): Promise<SharedFixture> {
  const ownerPriv = await seedOwnerAccess("c-owner", { email: "owner@example.com", displayName: "Olga" });
  const adminPriv = await seedOwnerAccess("c-admin", { email: "admin@example.com" });
  const editorPriv = await seedOwnerAccess("c-editor", { email: "editor@example.com" });
  const readerPriv = await seedOwnerAccess("c-reader", { email: "reader@example.com" });
  const ws = await createSharedWorkspace(ownerPriv.userId, { name: "Household", currency: "USD" });
  const owner = await loadWorkspaceAccess(ownerPriv.userId, ws.id);
  await addMember(owner, { email: "admin@example.com", role: "admin" }, ALLOW);
  await addMember(owner, { email: "editor@example.com", role: "editor" }, ALLOW);
  await addMember(owner, { email: "reader@example.com", role: "reader" }, ALLOW);
  return {
    owner,
    ownerPrivateId: ownerPriv.workspaceId,
    admin: await loadWorkspaceAccess(adminPriv.userId, ws.id),
    editor: await loadWorkspaceAccess(editorPriv.userId, ws.id),
    reader: await loadWorkspaceAccess(readerPriv.userId, ws.id),
    workspaceId: ws.id,
  };
}

suite("UC-33 convert private ↔ shared", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  // -------------------------------------------------------------------------
  it("104 — sharing keeps the id and every row; the user gets a new, empty private workspace in the profile currency", async () => {
    const me = await seedOwnerAccess("c-me", { email: "owner@example.com" });
    await setWorkspaceCurrency(me, "USD"); // mirrored into the profile
    await seedLedger(me, "me");
    await updateCurrency(me.userId, "GBP"); // profile now differs from the workspace
    const before = await snapshot(me.workspaceId);

    const summary = await getShareSummary(me);
    expect(summary.counts).toEqual({ months: 1, categories: 1, templates: 1, annuals: 1, actuals: 1 });

    const result = await shareMyPrivateWorkspace(me, { name: "  Our   home ", confirmName: "our home" });
    expect(result.workspaceId).toBe(me.workspaceId);

    const converted = await workspaceRepo.findWorkspaceById(me.workspaceId);
    expect(converted).toMatchObject({ kind: "shared", name: "Our home", personalUserId: null, currency: "USD" });
    expect(await snapshot(me.workspaceId)).toEqual(before);
    expect((await workspaceRepo.findMembership(me.workspaceId, me.userId))?.role).toBe("owner");

    const fresh = await workspaceRepo.findPrivateWorkspaceByUser(me.userId);
    expect(fresh).not.toBeNull();
    expect(fresh!.id).not.toBe(me.workspaceId);
    expect(fresh!.id).toBe(result.privateWorkspaceId);
    expect(fresh!.currency).toBe("GBP");
    expect((await workspaceRepo.findMembership(fresh!.id, me.userId))?.role).toBe("owner");
    expect(await workspaceRepo.countWorkspaceContents(fresh!.id)).toEqual({
      months: 0,
      categories: 0,
      templates: 0,
      annuals: 0,
      actuals: 0,
      members: 1,
    });
    expect(await workspaceRepo.listWorkspacesForUser(me.userId)).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  it("105 — only the private workspace's Owner can share it", async () => {
    const f = await seedShared();
    // A shared workspace cannot be shared again (Owner) …
    await expect(
      shareMyPrivateWorkspace(f.owner, { name: "Again", confirmName: "Again" }),
    ).rejects.toBeInstanceOf(WorkspaceAlreadySharedError);
    // … and its other members are refused by the role matrix first.
    for (const a of [f.admin, f.editor, f.reader]) {
      await expect(
        shareMyPrivateWorkspace(a, { name: "Mine", confirmName: "Mine" }),
      ).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    }
    // Someone else's private workspace: not a member → not found.
    const other = await seedOwnerAccess("c-other", { email: "other@example.com" });
    await expect(loadWorkspaceAccess(f.owner.userId, other.workspaceId)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    expect((await workspaceRepo.findWorkspaceById(other.workspaceId))?.kind).toBe("private");
  });

  // -------------------------------------------------------------------------
  it("106 — after sharing, members can be added, other users are untouched and the active workspace stays", async () => {
    const me = await seedOwnerAccess("c-me", { email: "owner@example.com" });
    const other = await seedOwnerAccess("c-other", { email: "other@example.com" });
    await seedLedger(other, "other");
    const otherBefore = await snapshot(other.workspaceId);

    await shareMyPrivateWorkspace(me, { name: "Flat", confirmName: "Flat" });
    const shared = await loadWorkspaceAccess(me.userId, me.workspaceId);
    expect(shared.kind).toBe("shared");
    const added = await addMember(shared, { email: "other@example.com", role: "editor" }, ALLOW);
    expect(added.status).toBe("member");
    expect((await workspaceRepo.findMembership(me.workspaceId, other.userId))?.role).toBe("editor");

    expect(await snapshot(other.workspaceId)).toEqual(otherBefore);
    expect((await workspaceRepo.findWorkspaceById(other.workspaceId))?.kind).toBe("private");

    const active = await resolveActiveWorkspaceFor(me.userId, me.workspaceId);
    expect(active.workspaceId).toBe(me.workspaceId);
    expect(active.kind).toBe("shared");
  });

  // -------------------------------------------------------------------------
  it("107 — sharing without a matching typed name, or without a valid name, changes nothing", async () => {
    const me = await seedOwnerAccess("c-me", { email: "owner@example.com" });
    await seedLedger(me, "me");
    const before = await snapshot(me.workspaceId);

    await expect(
      shareMyPrivateWorkspace(me, { name: "Flat", confirmName: "Flats" }),
    ).rejects.toBeInstanceOf(WorkspaceNameMismatchError);
    await expect(
      shareMyPrivateWorkspace(me, { name: "   ", confirmName: "" }),
    ).rejects.toBeInstanceOf(InvalidWorkspaceNameError);
    await expect(
      shareMyPrivateWorkspace(me, { name: "x".repeat(61), confirmName: "x".repeat(61) }),
    ).rejects.toBeInstanceOf(InvalidWorkspaceNameError);

    expect(await workspaceRepo.findWorkspaceById(me.workspaceId)).toMatchObject({
      kind: "private",
      personalUserId: me.userId,
    });
    expect(await workspaceRepo.listWorkspacesForUser(me.userId)).toHaveLength(1);
    expect(await snapshot(me.workspaceId)).toEqual(before);
  });

  // -------------------------------------------------------------------------
  it("108 — making private replaces the Owner's private workspace, removes members, invitations and the offer, keeps the shared rows", async () => {
    const f = await seedShared();
    await seedLedger(await loadWorkspaceAccess(f.owner.userId, f.ownerPrivateId), "priv");
    await seedLedger(f.owner, "shared");
    await addActual(f.editor, {
      monthId: (await monthIdOf(f.workspaceId))!,
      categoryId: (await categoryIdOf(f.workspaceId))!,
      name: "Bread",
      amount: "2.00",
    });
    await addMember(f.owner, { email: "invitee@example.com", role: "reader" }, ALLOW);
    await proposeOwnershipTransfer(f.owner, { toUserId: f.admin.userId }, ALLOW);
    const sharedBefore = await snapshot(f.workspaceId);

    const summary = await getMakePrivateSummary(f.owner);
    expect(summary.sharedName).toBe("Household");
    expect(summary.privateWorkspaceId).toBe(f.ownerPrivateId);
    expect(summary.privateCounts).toEqual({ months: 1, categories: 1, templates: 1, annuals: 1, actuals: 1 });
    expect(summary.members.map((m) => m.userId).sort()).toEqual(
      [f.admin.userId, f.editor.userId, f.reader.userId].sort(),
    );
    expect(summary.invitations.map((i) => i.email)).toEqual(["invitee@example.com"]);

    const result = await makeWorkspaceMyPrivate(f.owner, {
      confirmName: "household",
      acknowledgeDataLoss: true,
    });
    expect(result).toEqual({ workspaceId: f.workspaceId, name: "Household" });

    // The old private workspace and all its rows are gone.
    expect(await workspaceRepo.findWorkspaceById(f.ownerPrivateId)).toBeNull();
    expect(await snapshot(f.ownerPrivateId)).toEqual([]);

    // The shared workspace is now the private one, same id and rows.
    expect(await workspaceRepo.findWorkspaceById(f.workspaceId)).toMatchObject({
      kind: "private",
      personalUserId: f.owner.userId,
      name: null,
      currency: "USD",
    });
    expect((await workspaceRepo.findPrivateWorkspaceByUser(f.owner.userId))?.id).toBe(f.workspaceId);
    expect(await snapshot(f.workspaceId)).toEqual(sharedBefore);
    const members = await workspaceRepo.listMembers(f.workspaceId);
    expect(members.map((m) => [m.userId, m.role])).toEqual([[f.owner.userId, "owner"]]);
    expect(await workspaceRepo.listInvitations(f.workspaceId)).toEqual([]);
    const [{ n }] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspace_transfer WHERE workspace_id = ${f.workspaceId}`,
    );
    expect(n).toBe(0);
    // Currency mirrored into the profile (UC-31 §4.2.4).
    expect((await getProfileSettings(f.owner.userId))?.currency).toBe("USD");
    expect(await workspaceRepo.listWorkspacesForUser(f.owner.userId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  it("109 — making private is refused for Admin, Editor, Reader, non-members and private workspaces", async () => {
    const f = await seedShared();
    for (const a of [f.admin, f.editor, f.reader]) {
      await expect(
        makeWorkspaceMyPrivate(a, { confirmName: "Household", acknowledgeDataLoss: true }),
      ).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    }
    const outsider = await seedOwnerAccess("c-outsider", { email: "other@example.com" });
    await expect(loadWorkspaceAccess(outsider.userId, f.workspaceId)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
    await expect(
      makeWorkspaceMyPrivate(outsider, { confirmName: "", acknowledgeDataLoss: true }),
    ).rejects.toBeInstanceOf(PrivateWorkspaceImmutableError);
    expect((await workspaceRepo.findWorkspaceById(f.workspaceId))?.kind).toBe("shared");
    expect(await workspaceRepo.listMembers(f.workspaceId)).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  it("110 — making private without the typed name or the acknowledgement changes nothing", async () => {
    const f = await seedShared();
    await seedLedger(await loadWorkspaceAccess(f.owner.userId, f.ownerPrivateId), "priv");
    const privBefore = await snapshot(f.ownerPrivateId);

    await expect(
      makeWorkspaceMyPrivate(f.owner, { confirmName: "Houseold", acknowledgeDataLoss: true }),
    ).rejects.toBeInstanceOf(WorkspaceNameMismatchError);
    await expect(
      makeWorkspaceMyPrivate(f.owner, { confirmName: "Household", acknowledgeDataLoss: false }),
    ).rejects.toBeInstanceOf(DataLossNotAcknowledgedError);

    expect((await workspaceRepo.findWorkspaceById(f.workspaceId))?.kind).toBe("shared");
    expect(await workspaceRepo.listMembers(f.workspaceId)).toHaveLength(4);
    expect(await snapshot(f.ownerPrivateId)).toEqual(privBefore);
  });

  // -------------------------------------------------------------------------
  it("111 — former members lose access, fall back to their private workspace and keep their attribution", async () => {
    const f = await seedShared();
    const { category, month } = await seedLedger(f.owner, "shared");
    const bread = await addActual(f.editor, {
      monthId: month.id,
      categoryId: category.id,
      name: "Bread",
      amount: "2.00",
    });

    await makeWorkspaceMyPrivate(f.owner, { confirmName: "Household", acknowledgeDataLoss: true });

    for (const a of [f.admin, f.editor, f.reader]) {
      await expect(loadWorkspaceAccess(a.userId, f.workspaceId)).rejects.toBeInstanceOf(
        WorkspaceNotFoundError,
      );
      const active = await resolveActiveWorkspaceFor(a.userId, f.workspaceId);
      expect(active.kind).toBe("private");
      expect(active.workspaceId).not.toBe(f.workspaceId);
    }
    const [row] = await db.execute<{ created_by: string }>(
      sql`SELECT created_by_user_id::text AS created_by FROM month_actual_expense WHERE id = ${bread.id}`,
    );
    expect(row?.created_by).toBe(f.editor.userId);
    // "Added by" is not shown in a private workspace.
    const mine = await loadWorkspaceAccess(f.owner.userId, f.workspaceId);
    expect(mine.kind).toBe("private");
    expect(await getActualAuthorLabels(mine)).toEqual({});
  });

  // -------------------------------------------------------------------------
  it("112 — share, then make the same workspace private: original data and ids come back, the interim private workspace is gone", async () => {
    const me = await seedOwnerAccess("c-me", { email: "owner@example.com" });
    await seedLedger(me, "me");
    const before = await snapshot(me.workspaceId);

    const shared = await shareMyPrivateWorkspace(me, { name: "Flat", confirmName: "Flat" });
    const asOwner = await loadWorkspaceAccess(me.userId, me.workspaceId);
    await makeWorkspaceMyPrivate(asOwner, { confirmName: "Flat", acknowledgeDataLoss: true });

    expect(await workspaceRepo.findWorkspaceById(shared.privateWorkspaceId)).toBeNull();
    expect((await workspaceRepo.findPrivateWorkspaceByUser(me.userId))?.id).toBe(me.workspaceId);
    expect(await snapshot(me.workspaceId)).toEqual(before);
    expect(await workspaceRepo.listWorkspacesForUser(me.userId)).toHaveLength(1);

    // Re-submitting fails safely.
    const again = await loadWorkspaceAccess(me.userId, me.workspaceId);
    await expect(
      makeWorkspaceMyPrivate(again, { confirmName: "Flat", acknowledgeDataLoss: true }),
    ).rejects.toBeInstanceOf(PrivateWorkspaceImmutableError);
  });

  // -------------------------------------------------------------------------
  it("113 — a failure in the middle of either operation leaves both workspaces and memberships as before", async () => {
    // Share: fail while creating the new private workspace.
    const me = await seedOwnerAccess("c-me", { email: "owner@example.com" });
    await seedLedger(me, "me");
    const meBefore = await snapshot(me.workspaceId);
    const shareSpy = vi
      .spyOn(workspaceRepo, "insertPrivateWorkspace")
      .mockRejectedValueOnce(new Error("boom: simulated insert failure"));
    await expect(
      shareMyPrivateWorkspace(me, { name: "Flat", confirmName: "Flat" }),
    ).rejects.toThrow(/boom/);
    shareSpy.mockRestore();
    expect(await workspaceRepo.findWorkspaceById(me.workspaceId)).toMatchObject({
      kind: "private",
      personalUserId: me.userId,
      name: null,
    });
    expect(await workspaceRepo.listWorkspacesForUser(me.userId)).toHaveLength(1);
    expect(await snapshot(me.workspaceId)).toEqual(meBefore);

    // Make private: fail on the final re-label, after the deletes.
    const f = await seedShared();
    await seedLedger(await loadWorkspaceAccess(f.owner.userId, f.ownerPrivateId), "priv");
    const privBefore = await snapshot(f.ownerPrivateId);
    const privateSpy = vi
      .spyOn(workspaceRepo, "markPrivate")
      .mockRejectedValueOnce(new Error("boom: simulated relabel failure"));
    await expect(
      makeWorkspaceMyPrivate(f.owner, { confirmName: "Household", acknowledgeDataLoss: true }),
    ).rejects.toThrow(/boom/);
    privateSpy.mockRestore();
    expect((await workspaceRepo.findWorkspaceById(f.workspaceId))?.kind).toBe("shared");
    expect(await workspaceRepo.listMembers(f.workspaceId)).toHaveLength(4);
    expect((await workspaceRepo.findWorkspaceById(f.ownerPrivateId))?.kind).toBe("private");
    expect(await snapshot(f.ownerPrivateId)).toEqual(privBefore);
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function monthIdOf(workspaceId: string): Promise<string | undefined> {
  const [row] = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM month WHERE workspace_id = ${workspaceId} LIMIT 1`,
  );
  return row?.id;
}

async function categoryIdOf(workspaceId: string): Promise<string | undefined> {
  const [row] = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM category WHERE workspace_id = ${workspaceId} LIMIT 1`,
  );
  return row?.id;
}

/** Every tenant row of a workspace, by table and id (and ticket author). */
async function snapshot(workspaceId: string) {
  return db
    .execute<{ t: string; id: string; created_by: string | null }>(sql`
      SELECT 'category' AS t, id::text AS id, NULL AS created_by FROM category WHERE workspace_id = ${workspaceId}
      UNION ALL SELECT 'template', id::text, NULL FROM template WHERE workspace_id = ${workspaceId}
      UNION ALL SELECT 'annual', id::text, NULL FROM annual WHERE workspace_id = ${workspaceId}
      UNION ALL SELECT 'month', id::text, NULL FROM month WHERE workspace_id = ${workspaceId}
      UNION ALL SELECT 'line', l.id::text, NULL FROM month_fixed_line l
        JOIN month m ON m.id = l.month_id WHERE m.workspace_id = ${workspaceId}
      UNION ALL SELECT 'actual', a.id::text, a.created_by_user_id::text FROM month_actual_expense a
        JOIN month m ON m.id = a.month_id WHERE m.workspace_id = ${workspaceId}
      ORDER BY 1, 2
    `)
    .then((rows) => rows.map((r) => ({ ...r })));
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-33 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
