import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import {
  createTemplate,
  deactivateTemplate as deactivateTemplateService,
} from "@/server/services/templates";
import {
  DuplicateMonthError,
  MonthNotFoundError,
  createMonth,
  getMonthList,
  getMonthWorkspace,
} from "@/server/services/months";

// ============================================================================
// UC-06 month creation, cloning & home — integration (PRD §15 #3, #4, #18).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker. The schema (UC-00) already exposes `month`, `month_fixed_line`,
// and `template` with the FK + unique index the service relies on.
//
// Acceptance (PRD §6.3 / §7.8 / UC-06 spec):
//   - createMonth: inserts one `month` row + clones every ACTIVE template
//     into `month_fixed_line` (kind, remaining_amount = original_amount =
//     template amount, origin = 'cloned') in ONE transaction (ARCH §5).
//   - Duplicate `(user_id, year, month)` → DuplicateMonthError (the unique
//     index backs this; PRD UC-08).
//   - Inactive templates are NOT cloned; soft-deleting a template after
//     creation leaves the month untouched (PRD §6.3, §7.8).
//   - Months never sync with templates or each other afterwards; no rollover
//     (PRD C7, §7.8).
//   - getMonthList returns the user's months newest first (PRD UC-14).
//   - getMonthWorkspace returns the month header + reserved lines grouped
//     by kind (the workspace skeleton ships in UC-06; UC-07/08/11 fill in
//     incomes, actuals, and summary).
//   - Incomes are NOT cloned (PRD §7.8).
//   - Two tenants are isolated: each only sees their own months (PRD §5.1).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-06 month creation, cloning & home", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("creates a month with no templates (zero rows cloned)", async () => {
    const userId = await seedUser("google-sub-uc06-empty");

    const month = await createMonth(userId, { year: 2026, month: 8 });

    expect(month.userId).toBe(userId);
    expect(month.year).toBe(2026);
    expect(month.month).toBe(8);

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.month.id).toBe(month.id);
    expect(workspace.lines).toHaveLength(0);
    expect(workspace.incomes).toHaveLength(0);
    expect(workspace.actuals).toHaveLength(0);
  });

  it("rejects a duplicate (user, year, month) with DuplicateMonthError (PRD UC-08)", async () => {
    const userId = await seedUser("google-sub-uc06-dup");

    await createMonth(userId, { year: 2026, month: 8 });

    await expect(createMonth(userId, { year: 2026, month: 8 })).rejects.toBeInstanceOf(
      DuplicateMonthError,
    );

    // No phantom rows inserted.
    const list = await getMonthList(userId);
    expect(list).toHaveLength(1);
  });

  it("clones every active template as a reserved line (PRD C17, §6.3)", async () => {
    const userId = await seedUser("google-sub-uc06-clone");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });

    const month = await createMonth(userId, { year: 2026, month: 8 });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(2);

    const mortgage = workspace.lines.find((l) => l.name === "Mortgage");
    const groceriesLine = workspace.lines.find((l) => l.name === "Groceries");
    expect(mortgage).toBeDefined();
    expect(mortgage!.categoryId).toBe(groceries.id);
    expect(mortgage!.kind).toBe("committed");
    expect(mortgage!.origin).toBe("cloned");
    expect(mortgage!.remainingAmount).toBe("800.00");
    expect(mortgage!.originalAmount).toBe("800.00");
    expect(groceriesLine).toBeDefined();
    expect(groceriesLine!.kind).toBe("estimated");
    expect(groceriesLine!.remainingAmount).toBe("400.00");
    expect(groceriesLine!.originalAmount).toBe("400.00");

    expect(workspace.incomes).toHaveLength(0);
    expect(workspace.actuals).toHaveLength(0);

    // The FK is on month_fixed_line.month_id → month.id, so the cloned rows
    // really are bound to this month.
    const rows = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM month_fixed_line WHERE month_id = ${month.id}
    `);
    expect(Number.parseInt(rows[0]!.n, 10)).toBe(2);
  });

  it("does NOT clone inactive templates (PRD §6.3, §7.8)", async () => {
    const userId = await seedUser("google-sub-uc06-inactive-template");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const mortgage = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await deactivateTemplateService(userId, { id: mortgage.id });

    await createMonth(userId, { year: 2026, month: 8 });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(1);
    expect(workspace.lines[0]!.name).toBe("Groceries");
  });

  it("months never sync: editing a template after creation does NOT rewrite the month (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc06-no-sync");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const mortgage = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });

    await createMonth(userId, { year: 2026, month: 8 });

    // Edit + deactivate the source template. The cloned line keeps the
    // snapshot amount (800.00) and stays in the workspace.
    const { updateTemplate } = await import("@/server/services/templates");
    await updateTemplate(userId, {
      id: mortgage.id,
      categoryId: groceries.id,
      name: "Mortgage (renamed)",
      amount: "950.00",
      kind: "committed",
    });
    await deactivateTemplateService(userId, { id: mortgage.id });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(1);
    expect(workspace.lines[0]!.name).toBe("Mortgage");
    expect(workspace.lines[0]!.remainingAmount).toBe("800.00");
    expect(workspace.lines[0]!.originalAmount).toBe("800.00");
  });

  it("months never sync across periods: creating Aug does NOT clone Sep content (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc06-no-cross-sync");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });

    await createMonth(userId, { year: 2026, month: 8 });
    await createMonth(userId, { year: 2026, month: 9 });

    const august = await getMonthWorkspace(userId, 2026, 8);
    const september = await getMonthWorkspace(userId, 2026, 9);
    expect(august.lines).toHaveLength(1);
    expect(september.lines).toHaveLength(1);
    expect(august.lines[0]!.id).not.toBe(september.lines[0]!.id);
    expect(august.lines[0]!.monthId).toBe(august.month.id);
    expect(september.lines[0]!.monthId).toBe(september.month.id);
  });

  it("getMonthList returns the user's months newest first (PRD UC-14)", async () => {
    const userId = await seedUser("google-sub-uc06-list");

    await createMonth(userId, { year: 2025, month: 6 });
    await createMonth(userId, { year: 2026, month: 1 });
    await createMonth(userId, { year: 2026, month: 8 });

    const list = await getMonthList(userId);
    expect(list.map((m) => ({ y: m.year, m: m.month }))).toEqual([
      { y: 2026, m: 8 },
      { y: 2026, m: 1 },
      { y: 2025, m: 6 },
    ]);
  });

  it("getMonthWorkspace throws MonthNotFoundError for a missing period", async () => {
    const userId = await seedUser("google-sub-uc06-missing");

    await expect(getMonthWorkspace(userId, 2026, 8)).rejects.toBeInstanceOf(
      MonthNotFoundError,
    );
  });

  it("two tenants are isolated: Alice's months never leak into Bob's lists (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc06-iso-alice");
    const bob = await seedUser("google-sub-uc06-iso-bob");

    await createMonth(alice, { year: 2026, month: 8 });
    await createMonth(bob, { year: 2026, month: 8 });

    const aliceMonths = await getMonthList(alice);
    const bobMonths = await getMonthList(bob);

    expect(aliceMonths).toHaveLength(1);
    expect(bobMonths).toHaveLength(1);
    expect(aliceMonths[0]!.userId).toBe(alice);
    expect(bobMonths[0]!.userId).toBe(bob);

    // Cross-tenant workspace read surfaces as not-found.
    const aliceAug = await getMonthWorkspace(alice, 2026, 8);
    const bobAug = await getMonthWorkspace(bob, 2026, 8);
    expect(aliceAug.month.id).not.toBe(bobAug.month.id);
  });

  it("duplicate creation does NOT leak partial clones (transaction integrity)", async () => {
    const userId = await seedUser("google-sub-uc06-atomicity");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });

    await createMonth(userId, { year: 2026, month: 8 });
    await expect(createMonth(userId, { year: 2026, month: 8 })).rejects.toBeInstanceOf(
      DuplicateMonthError,
    );

    // The first creation succeeded with one cloned line; the failed attempt
    // did not insert anything else.
    const rows = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM month WHERE user_id = ${userId}
    `);
    expect(Number.parseInt(rows[0]!.n, 10)).toBe(1);

    const lineRows = await db.execute<{ n: string }>(sql`
      SELECT COUNT(*)::text AS n FROM month_fixed_line
        WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    `);
    expect(Number.parseInt(lineRows[0]!.n, 10)).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) {
    throw new Error("seedUser returned no id");
  }
  return id;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-06 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // month cascades from app_user; month_fixed_line cascades from month.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
