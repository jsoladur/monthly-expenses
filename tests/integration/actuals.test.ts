import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { monthActualExpense } from "@/server/db/schema";
import {
  CategoryNotFoundError,
  createCategory,
  deactivateCategory,
} from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import {
  ActualNotFoundError,
  IncomeCategoryError,
  InactiveCategoryError,
  MonthNotFoundError,
  addActual,
  deleteActual,
  editActual,
  listActualsForMonth,
} from "@/server/services/actuals";

// ============================================================================
// UC-08 actual expenses (tickets) — integration (PRD §6.7 / §7.2 / §7.3,
// C15 / UC-10 / UC-16, ARCH §5).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
//
// Acceptance (PRD §15 #11, #14, #15):
//   - addActual: month must belong to the user (PRD §5.1); category must be
//     ACTIVE EXPENSE-kind (PRD §6.7); amount is a wire string that becomes
//     integer cents per ADR-5 / ARCH §8; observations is OPTIONAL (PRD §6.7);
//     negative amounts allowed (PRD UC-16); adding NEVER mutates any
//     `month_fixed_line.remaining_amount` (PRD §7.2 / §7.3, no auto-balance).
//   - editActual: same shape; the row must belong to a month owned by the
//     user. MUST set `edited_after_conversion = true` — UC-10 uses this as
//     the undo gate (PRD §7.5).
//   - deleteActual: HARD delete (PRD C15 / §13). The row is gone from every
//     subsequent read and from the physical DB (no soft delete on
//     month-scoped money rows).
//   - Historical actuals keep rendering even after their category is
//     deactivated (PRD §6.2).
//   - Two tenants are isolated: each only sees / mutates their own actuals
//     (PRD §5.1, UC-17).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-08 actual expenses", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("adds an actual with the wire string round-tripped through cents", async () => {
    const userId = await seedUser("google-sub-uc08-add");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "85.50",
    });

    expect(actual.monthId).toBe(created.id);
    expect(actual.categoryId).toBe(groceries.id);
    expect(actual.name).toBe("Weekly groceries");
    expect(actual.amount).toBe("85.50");
    expect(actual.observations).toBeNull();
    expect(actual.editedAfterConversion).toBe(false);

    const list = await listActualsForMonth(userId, created.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(actual.id);
  });

  it("persists observations verbatim (PRD §6.7 — optional, free text)", async () => {
    const userId = await seedUser("google-sub-uc08-obs");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread + milk",
      observations: "Bakery on 5th",
      amount: "12.30",
    });

    expect(actual.observations).toBe("Bakery on 5th");
  });

  it("accepts a negative amount (PRD UC-16, algebraic sum)", async () => {
    const userId = await seedUser("google-sub-uc08-negative");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Refund",
      amount: "-20.00",
    });

    expect(actual.amount).toBe("-20.00");
  });

  it("rejects an INCOME category with IncomeCategoryError — actuals are expense-only (PRD §6.7)", async () => {
    const userId = await seedUser("google-sub-uc08-income-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    await expect(
      addActual(userId, {
        monthId: created.id,
        categoryId: salary.id,
        name: "Bad row",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(IncomeCategoryError);
  });

  it("rejects an INACTIVE expense category with InactiveCategoryError (PRD §6.7, #11)", async () => {
    const userId = await seedUser("google-sub-uc08-inactive-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: groceries.id });

    await expect(
      addActual(userId, {
        monthId: created.id,
        categoryId: groceries.id,
        name: "Should fail",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(InactiveCategoryError);
  });

  it("rejects an unknown category id with CategoryNotFoundError", async () => {
    const userId = await seedUser("google-sub-uc08-unknown-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });

    await expect(
      addActual(userId, {
        monthId: created.id,
        categoryId: "00000000-0000-0000-0000-000000000000",
        name: "Bad",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("rejects a missing month with MonthNotFoundError (PRD §5.1)", async () => {
    const userId = await seedUser("google-sub-uc08-missing-month");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    await expect(
      addActual(userId, {
        monthId: "00000000-0000-0000-0000-000000000000",
        categoryId: groceries.id,
        name: "Bad",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
  });

  it("edits an existing actual and sets edited_after_conversion = true (PRD §7.5 undo gate)", async () => {
    const userId = await seedUser("google-sub-uc08-edit");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const dining = await createCategory(userId, { kind: "expense", name: "Dining" });

    const original = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });
    expect(original.editedAfterConversion).toBe(false);

    const updated = await editActual(userId, {
      id: original.id,
      categoryId: dining.id,
      name: "Lunch",
      observations: "with team",
      amount: "12.50",
    });

    expect(updated.id).toBe(original.id);
    expect(updated.categoryId).toBe(dining.id);
    expect(updated.name).toBe("Lunch");
    expect(updated.observations).toBe("with team");
    expect(updated.amount).toBe("12.50");
    // Edit MUST set the flag — UC-10's undo path keys off this.
    expect(updated.editedAfterConversion).toBe(true);
  });

  it("clears observations when edited with no observations (round-trip via nullable column)", async () => {
    const userId = await seedUser("google-sub-uc08-clear-obs");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const original = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      observations: "with seeds",
      amount: "5.00",
    });

    const updated = await editActual(userId, {
      id: original.id,
      categoryId: groceries.id,
      name: "Bread",
      observations: null,
      amount: "5.00",
    });

    expect(updated.observations).toBeNull();
  });

  it("hard-deletes an actual and removes it from every subsequent read (PRD C15 / #15)", async () => {
    const userId = await seedUser("google-sub-uc08-delete");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });

    await deleteActual(userId, { id: actual.id });

    const list = await listActualsForMonth(userId, created.id);
    expect(list).toHaveLength(0);

    // Physical row is GONE — PRD C15 / §13 hard delete on month-scoped money.
    const rows = await db
      .select()
      .from(monthActualExpense)
      .where(sql`id = ${actual.id}`);
    expect(rows).toHaveLength(0);
  });

  it("rejects edit/delete on a missing row with ActualNotFoundError", async () => {
    const userId = await seedUser("google-sub-uc08-missing");

    await expect(
      editActual(userId, {
        id: "00000000-0000-0000-0000-000000000000",
        categoryId: "00000000-0000-0000-0000-000000000000",
        name: "Nope",
        amount: "1.00",
      }),
    ).rejects.toBeInstanceOf(ActualNotFoundError);

    await expect(
      deleteActual(userId, { id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toBeInstanceOf(ActualNotFoundError);
  });

  it("historical actuals keep displaying even after their category is deactivated (PRD §6.2, #11)", async () => {
    const userId = await seedUser("google-sub-uc08-historical");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });

    await deactivateCategory(userId, { id: groceries.id });

    const list = await listActualsForMonth(userId, created.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(actual.id);
    expect(list[0]!.categoryId).toBe(groceries.id); // points at the now-inactive category
  });

  it("adding an actual NEVER mutates any month_fixed_line.remaining_amount (PRD §7.2 / §7.3)", async () => {
    const userId = await seedUser("google-sub-uc08-no-balance");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    // Seed an ACTIVE template so the clone produces at least one
    // `month_fixed_line` row to guard against mutation.
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries envelope",
      observations: null,
      amount: "200.00",
      kind: "estimated",
    });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const before = await loadReservedLineAmounts(userId, created.id);
    expect(before.length).toBeGreaterThan(0); // clone produced at least one line

    await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });
    await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Milk",
      amount: "3.50",
    });

    const after = await loadReservedLineAmounts(userId, created.id);
    expect(after).toEqual(before); // PRD §7.2 / §7.3 — tickets don't reduce envelopes
  });

  it("two tenants are isolated: Alice's actuals never leak into Bob's month (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc08-iso-alice");
    const bob = await seedUser("google-sub-uc08-iso-bob");

    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    const bobMonth = await createMonth(bob, { year: 2026, month: 8 });

    const aliceGroceries = await createCategory(alice, { kind: "expense", name: "Groceries" });
    const bobGroceries = await createCategory(bob, { kind: "expense", name: "Groceries" });

    const aliceActual = await addActual(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceGroceries.id,
      name: "Alice bread",
      amount: "5.00",
    });
    const bobActual = await addActual(bob, {
      monthId: bobMonth.id,
      categoryId: bobGroceries.id,
      name: "Bob bread",
      amount: "7.00",
    });

    const aliceList = await listActualsForMonth(alice, aliceMonth.id);
    const bobList = await listActualsForMonth(bob, bobMonth.id);
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]!.id).toBe(aliceActual.id);
    expect(bobList).toHaveLength(1);
    expect(bobList[0]!.id).toBe(bobActual.id);

    // Cross-tenant edit/delete surfaces as not-found.
    await expect(
      editActual(alice, {
        id: bobActual.id,
        categoryId: aliceGroceries.id,
        name: "Hijack",
        amount: "999.00",
      }),
    ).rejects.toBeInstanceOf(ActualNotFoundError);

    await expect(deleteActual(alice, { id: bobActual.id })).rejects.toBeInstanceOf(
      ActualNotFoundError,
    );
  });

  it("actual CRUD never creates or modifies a template row (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc08-no-template");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const before = await countTemplateRows();
    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });
    await editActual(userId, {
      id: actual.id,
      categoryId: groceries.id,
      name: "Milk",
      amount: "3.50",
    });
    await deleteActual(userId, { id: actual.id });
    const after = await countTemplateRows();

    expect(after).toEqual(before);
  });

  it("actual CRUD never mutates month_income rows (orthogonal to UC-07)", async () => {
    const userId = await seedUser("google-sub-uc08-no-income");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    const before = await countIncomeRows();
    await addActual(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "5.00",
    });
    const after = await countIncomeRows();

    expect(after).toEqual(before);
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

async function loadReservedLineAmounts(
  userId: string,
  monthId: string,
): Promise<{ id: string; remainingAmount: string }[]> {
  return db.execute<{ id: string; remainingAmount: string }>(sql`
    SELECT month_fixed_line.id::text AS id, month_fixed_line.remaining_amount::text AS "remainingAmount"
    FROM month_fixed_line
    INNER JOIN month ON month.id = month_fixed_line.month_id
    WHERE month.user_id = ${userId} AND month.id = ${monthId}
    ORDER BY month_fixed_line.created_at
  `);
}

async function countTemplateRows(): Promise<{ n: string }[]> {
  return db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM template`);
}

async function countIncomeRows(): Promise<{ n: string }[]> {
  return db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM month_income`);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-08 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // month cascades from app_user; month_actual_expense cascades from month.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
