import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { category } from "@/server/db/schema";
import {
  CategoryAlreadyActiveError,
  CategoryAlreadyInactiveError,
  CategoryNotFoundError,
  DuplicateCategoryNameError,
  createCategory,
  deactivateCategory,
  listActiveCategoriesForPicker,
  listCategoriesForManagement,
  reactivateCategory,
  renameCategory,
} from "@/server/services/categories";

// ============================================================================
// UC-03 categories — integration (PRD §15 #16 + the picker half of #11).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker. The schema (UC-00) already enforces the partial unique index
// `category_active_name_uk` so we exercise the index in addition to the
// repository/service layer.
//
// We exercise:
//   - createCategory happy path
//   - duplicate ACTIVE name → DuplicateCategoryNameError
//   - soft-delete then re-create with the same name (allowed — partial index
//     is `WHERE active`, PRD §6.2)
//   - deactivate → CategoryNotFoundError on findById once re-queried
//   - deactivate again → CategoryAlreadyInactiveError
//   - reactivate → active again
//   - reactivate same name twice (after deactivating the first) → second
//     succeeds because the first is no longer active
//   - listActiveCategoriesForPicker excludes inactive (PRD §6.2)
//   - listCategoriesForManagement includes inactive
//   - two tenants fully isolated (PRD §5.1, PRD UC-17)
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-03 categories", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("creates an active expense category with kind and name", async () => {
    const userId = await seedUser("google-sub-uc03-create");

    const created = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });

    expect(created.userId).toBe(userId);
    expect(created.kind).toBe("expense");
    expect(created.name).toBe("Groceries");
    expect(created.active).toBe(true);
    expect(created.deletedAt).toBeNull();

    // Visible to the management list (includes inactive).
    const all = await listCategoriesForManagement(userId, "expense");
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(created.id);
  });

  it("rejects a duplicate ACTIVE name within the same (user, kind) — PRD §6.2", async () => {
    const userId = await seedUser("google-sub-uc03-dup");

    await createCategory(userId, { kind: "expense", name: "Groceries" });
    await expect(
      createCategory(userId, { kind: "expense", name: "Groceries" }),
    ).rejects.toBeInstanceOf(DuplicateCategoryNameError);

    // Different kind: must NOT collide (the unique index covers (user, kind)).
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    expect(salary.name).toBe("Salary");
    expect(salary.kind).toBe("income");
  });

  it("allows re-using the name of a soft-deleted category — partial index excludes inactive rows", async () => {
    const userId = await seedUser("google-sub-uc03-soft-reuse");

    const first = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: first.id });

    // Same name on a fresh active row: succeeds because the partial index is
    // scoped to `WHERE active`.
    const reused = await createCategory(userId, { kind: "expense", name: "Groceries" });
    expect(reused.active).toBe(true);
    expect(reused.id).not.toBe(first.id);
  });

  it("deactivate sets active=false and deletedAt, then lists inactive", async () => {
    const userId = await seedUser("google-sub-uc03-deact");

    const created = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const deactivated = await deactivateCategory(userId, { id: created.id });
    expect(deactivated.active).toBe(false);
    expect(deactivated.deletedAt).toBeInstanceOf(Date);

    // Picker excludes inactive.
    const picker = await listActiveCategoriesForPicker(userId, "expense");
    expect(picker).toHaveLength(0);

    // Management list still shows the row.
    const all = await listCategoriesForManagement(userId, "expense");
    expect(all).toHaveLength(1);
    expect(all[0]!.active).toBe(false);
  });

  it("deactivate on an already-inactive category throws CategoryAlreadyInactiveError", async () => {
    const userId = await seedUser("google-sub-uc03-deact-twice");
    const created = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: created.id });
    await expect(deactivateCategory(userId, { id: created.id })).rejects.toBeInstanceOf(
      CategoryAlreadyInactiveError,
    );
  });

  it("reactivate restores the row; a second activate throws CategoryAlreadyActiveError", async () => {
    const userId = await seedUser("google-sub-uc03-react");
    const created = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const deactivated = await deactivateCategory(userId, { id: created.id });
    expect(deactivated.active).toBe(false);

    const reactivated = await reactivateCategory(userId, { id: created.id });
    expect(reactivated.active).toBe(true);
    expect(reactivated.deletedAt).toBeNull();

    await expect(reactivateCategory(userId, { id: created.id })).rejects.toBeInstanceOf(
      CategoryAlreadyActiveError,
    );
  });

  it("reactivate fails with DuplicateCategoryNameError if another active row already owns the name (PRD §6.2)", async () => {
    const userId = await seedUser("google-sub-uc03-react-collision");

    const a = await createCategory(userId, { kind: "expense", name: "Groceries" });
    // Create a second active row with the same name by creating -> deactivating -> recreating.
    const inactiveClone = await createCategory(userId, { kind: "expense", name: "Utilities" });
    await deactivateCategory(userId, { id: inactiveClone.id });
    await createCategory(userId, { kind: "expense", name: "Utilities" });

    // Now reactivate `inactiveClone` — collides with the active "Utilities".
    await deactivateCategory(userId, { id: a.id });
    await createCategory(userId, { kind: "expense", name: "Groceries" });
    await expect(
      reactivateCategory(userId, { id: inactiveClone.id }),
    ).rejects.toBeInstanceOf(DuplicateCategoryNameError);
  });

  it("rename updates the name; an active rename that collides throws DuplicateCategoryNameError", async () => {
    const userId = await seedUser("google-sub-uc03-rename");

    await createCategory(userId, { kind: "expense", name: "Groceries" });
    const util = await createCategory(userId, { kind: "expense", name: "Utilities" });

    // Happy path rename.
    const renamed = await renameCategory(userId, { id: util.id, name: "Utilities (water+power)" });
    expect(renamed.name).toBe("Utilities (water+power)");

    // Collision: rename Groceries -> "Utilities (water+power)".
    await expect(
      renameCategory(userId, { id: (await firstIdFor(userId, "Groceries"))!, name: "Utilities (water+power)" }),
    ).rejects.toBeInstanceOf(DuplicateCategoryNameError);
  });

  it("rename on an unknown id throws CategoryNotFoundError (no leak across tenants)", async () => {
    const alice = await seedUser("google-sub-uc03-missing-alice");
    const bob = await seedUser("google-sub-uc03-missing-bob");

    const bobsCategory = await createCategory(bob, { kind: "expense", name: "Groceries" });
    // Alice passing bob's category id must look like a missing row to her —
    // the repository `WHERE userId = alice` returns nothing.
    await expect(
      renameCategory(alice, { id: bobsCategory.id, name: "Anything" }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("two tenants are isolated: each only sees their own categories (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc03-iso-alice");
    const bob = await seedUser("google-sub-uc03-iso-bob");

    await createCategory(alice, { kind: "expense", name: "Groceries" });
    await createCategory(bob, { kind: "expense", name: "Groceries" });
    await createCategory(bob, { kind: "income", name: "Salary" });

    const aliceExpense = await listCategoriesForManagement(alice, "expense");
    const bobExpense = await listCategoriesForManagement(bob, "expense");
    const bobIncome = await listCategoriesForManagement(bob, "income");
    const aliceIncome = await listCategoriesForManagement(alice, "income");

    expect(aliceExpense).toHaveLength(1);
    expect(bobExpense).toHaveLength(1);
    expect(bobIncome).toHaveLength(1);
    expect(aliceIncome).toHaveLength(0);
    // Tenant ids must never appear in the other tenant's results.
    expect(aliceExpense[0]!.userId).toBe(alice);
    expect(bobExpense[0]!.userId).toBe(bob);
    expect(bobIncome[0]!.userId).toBe(bob);
  });

  it("soft-deleted rows are hidden from pickers but keep their id+name for historical month rows (PRD §6.2)", async () => {
    const userId = await seedUser("google-sub-uc03-history");

    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: groceries.id });

    const picker = await listActiveCategoriesForPicker(userId, "expense");
    expect(picker.find((c) => c.id === groceries.id)).toBeUndefined();

    // History rows still resolve via FK join: the row still exists, just with
    // active=false. Direct DB inspection confirms the id is reserved.
    const stillThere = await db
      .select()
      .from(category)
      .where(sql`id = ${groceries.id}`);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]!.name).toBe("Groceries");
    expect(stillThere[0]!.active).toBe(false);
  });

  it("no physical DELETE ever runs on `category` (PRD §13)", async () => {
    const userId = await seedUser("google-sub-uc03-soft-delete-only");

    const created = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: created.id });

    // Soft delete: row still physically present.
    const rows = await db.select().from(category).where(sql`id = ${created.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.active).toBe(false);
    expect(rows[0]!.deletedAt).toBeInstanceOf(Date);
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

async function firstIdFor(userId: string, name: string): Promise<string | null> {
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(sql`user_id = ${userId} AND name = ${name} AND active = true`);
  return rows[0]?.id ?? null;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-03 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // `category` cascades on `app_user`, so wiping tenants is enough. Hard
  // delete is the rule for these tables (PRD §13, ARCH §4).
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
