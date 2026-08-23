import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { monthIncome } from "@/server/db/schema";
import {
  CategoryNotFoundError,
  createCategory,
  deactivateCategory,
} from "@/server/services/categories";
import {
  addIncome,
  deleteIncome,
  editIncome,
  ExpenseCategoryError,
  InactiveCategoryError,
  IncomeNotFoundError,
  listIncomesForMonth,
} from "@/server/services/incomes";
import { createMonth } from "@/server/services/months";

// ============================================================================
// UC-07 month incomes — integration (PRD §6.5 / §7.8, UC-09, C15).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
//
// Acceptance (PRD §6.5 / §7.8 / C15):
//   - addIncome: month must belong to the user (PRD §5.1); category must
//     exist (PRD §6.2) and be ACTIVE + INCOME-kind; amount is a wire string
//     that becomes integer cents per ADR-5 / ARCH §8; no observations field
//     (PRD §6.5); negative amounts are allowed (PRD UC-16).
//   - editIncome: same shape as addIncome (without monthId); the row must
//     belong to a month owned by the user.
//   - deleteIncome: HARD delete (PRD C15 / §13). The row is gone from every
//     subsequent read.
//   - Historical incomes keep rendering even after their category is
//     deactivated (PRD §6.5).
//   - Two tenants are isolated: each only sees / mutates their own incomes
//     (PRD §5.1, UC-17).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-07 month incomes", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("adds an income row with the wire string round-tripped through cents", async () => {
    const userId = await seedUser("google-sub-uc07-add");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    const income = await addIncome(userId, {
      monthId: created.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    // month_income has no user_id column — tenancy flows through the
    // parent month's join (PRD §5.1). We just assert the row landed in
    // our month.
    expect(income.monthId).toBe(created.id);

    const list = await listIncomesForMonth(userId, created.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(income.id);
  });

  it("accepts a negative amount (PRD UC-16)", async () => {
    const userId = await seedUser("google-sub-uc07-negative");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const refunds = await createCategory(userId, { kind: "income", name: "Refunds" });

    const income = await addIncome(userId, {
      monthId: created.id,
      categoryId: refunds.id,
      name: "Returned item",
      amount: "-20.00",
    });

    expect(income.amount).toBe("-20.00");
  });

  it("rejects an EXPENSE category with ExpenseCategoryError — incomes are income-only (PRD §6.5)", async () => {
    const userId = await seedUser("google-sub-uc07-expense-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    await expect(
      addIncome(userId, {
        monthId: created.id,
        categoryId: groceries.id,
        name: "Bad row",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(ExpenseCategoryError);
  });

  it("rejects an INACTIVE income category with InactiveCategoryError — historical incomes only", async () => {
    const userId = await seedUser("google-sub-uc07-inactive-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await deactivateCategory(userId, { id: salary.id });

    await expect(
      addIncome(userId, {
        monthId: created.id,
        categoryId: salary.id,
        name: "Should fail",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(InactiveCategoryError);
  });

  it("rejects an unknown category id with CategoryNotFoundError", async () => {
    const userId = await seedUser("google-sub-uc07-unknown-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });

    await expect(
      addIncome(userId, {
        monthId: created.id,
        categoryId: "00000000-0000-0000-0000-000000000000",
        name: "Bad",
        amount: "100.00",
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("edits an existing income (category, name, amount)", async () => {
    const userId = await seedUser("google-sub-uc07-edit");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    const bonus = await createCategory(userId, { kind: "income", name: "Bonus" });

    const original = await addIncome(userId, {
      monthId: created.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    const updated = await editIncome(userId, {
      id: original.id,
      categoryId: bonus.id,
      name: "Year-end bonus",
      amount: "2500.00",
    });

    expect(updated.id).toBe(original.id);
    expect(updated.monthId).toBe(created.id);
    expect(updated.categoryId).toBe(bonus.id);
    expect(updated.name).toBe("Year-end bonus");
    expect(updated.amount).toBe("2500.00");
  });

  it("hard-deletes an income and removes it from every subsequent read (PRD C15)", async () => {
    const userId = await seedUser("google-sub-uc07-delete");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    const income = await addIncome(userId, {
      monthId: created.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    await deleteIncome(userId, { id: income.id });

    // Logical read returns empty.
    const list = await listIncomesForMonth(userId, created.id);
    expect(list).toHaveLength(0);

    // Physical row is GONE — PRD C15 / §13 hard delete on month-scoped money.
    const rows = await db
      .select()
      .from(monthIncome)
      .where(sql`id = ${income.id}`);
    expect(rows).toHaveLength(0);
  });

  it("rejects edit/delete on a missing row with IncomeNotFoundError", async () => {
    const userId = await seedUser("google-sub-uc07-missing");

    await expect(
      editIncome(userId, {
        id: "00000000-0000-0000-0000-000000000000",
        categoryId: "00000000-0000-0000-0000-000000000000",
        name: "Nope",
        amount: "1.00",
      }),
    ).rejects.toBeInstanceOf(IncomeNotFoundError);

    await expect(
      deleteIncome(userId, { id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toBeInstanceOf(IncomeNotFoundError);
  });

  it("historical incomes keep displaying even after their category is deactivated (PRD §6.5)", async () => {
    const userId = await seedUser("google-sub-uc07-historical");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    const income = await addIncome(userId, {
      monthId: created.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    await deactivateCategory(userId, { id: salary.id });

    // The income is still there — listIncomesForMonth joins by month_id only
    // (the category FK is ON DELETE RESTRICT but the soft-delete doesn't
    // touch it).
    const list = await listIncomesForMonth(userId, created.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(income.id);
    expect(list[0]!.categoryId).toBe(salary.id); // points at the now-inactive category
  });

  it("two tenants are isolated: Alice's incomes never leak into Bob's month (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc07-iso-alice");
    const bob = await seedUser("google-sub-uc07-iso-bob");

    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    const bobMonth = await createMonth(bob, { year: 2026, month: 8 });

    const aliceSalary = await createCategory(alice, { kind: "income", name: "Salary" });
    const bobSalary = await createCategory(bob, { kind: "income", name: "Salary" });

    const aliceIncome = await addIncome(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceSalary.id,
      name: "Alice salary",
      amount: "100.00",
    });
    const bobIncome = await addIncome(bob, {
      monthId: bobMonth.id,
      categoryId: bobSalary.id,
      name: "Bob salary",
      amount: "300.00",
    });

    // Alice's list has only Alice's row; Bob's list has only Bob's row.
    const aliceList = await listIncomesForMonth(alice, aliceMonth.id);
    const bobList = await listIncomesForMonth(bob, bobMonth.id);
    expect(aliceList).toHaveLength(1);
    expect(aliceList[0]!.id).toBe(aliceIncome.id);
    expect(bobList).toHaveLength(1);
    expect(bobList[0]!.id).toBe(bobIncome.id);

    // Cross-tenant edit/delete surfaces as not-found (no row belongs to the
    // wrong tenant's month join).
    await expect(
      editIncome(alice, {
        id: bobIncome.id,
        categoryId: aliceSalary.id,
        name: "Hijack",
        amount: "999.00",
      }),
    ).rejects.toBeInstanceOf(IncomeNotFoundError);

    await expect(deleteIncome(alice, { id: bobIncome.id })).rejects.toBeInstanceOf(
      IncomeNotFoundError,
    );
  });

  it("income CRUD never creates or modifies a template row (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc07-no-template");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    const before = await countTemplateRows();
    const income = await addIncome(userId, {
      monthId: created.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });
    await editIncome(userId, {
      id: income.id,
      categoryId: salary.id,
      name: "Bonus",
      amount: "500.00",
    });
    await deleteIncome(userId, { id: income.id });
    const after = await countTemplateRows();

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

async function countTemplateRows(): Promise<{ n: string }[]> {
  return db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM template`);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-07 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // month cascades from app_user; month_income cascades from month.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
