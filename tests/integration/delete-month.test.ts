import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createTemplate, updateTemplate } from "@/server/services/templates";
import {
  createMonth,
  deleteMonth,
  getMonthList,
  getMonthWorkspace,
  MonthNotFoundError,
} from "@/server/services/months";
import { addActual } from "@/server/services/actuals";
import { addIncome } from "@/server/services/incomes";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";
import { searchActuals } from "@/server/services/search";

// ============================================================================
// UC-27 delete a month (proposed PRD §15 #58, #59, #61). #60 (cookie) is an
// action-level concern and lives in tests/e2e/delete-month.spec.ts.
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-27 delete month", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#58 removes the month and all its rows; other months untouched; Search stops seeing it", async () => {
    const userId = await seedUser("google-sub-uc27-cascade");
    const { nov, dec } = await seedNovDec(userId);

    const before = await getMonthWorkspace(userId, 2026, 11);
    expect(before.incomes).toHaveLength(2);
    expect(before.lines).toHaveLength(5);
    expect(before.actuals).toHaveLength(7);
    expect((await searchActuals(userId, "Ticket")).status).toBe("ok");

    const result = await deleteMonth(userId, { monthId: nov.id });
    expect(result).toEqual({ year: 2026, month: 11 });

    await expect(getMonthWorkspace(userId, 2026, 11)).rejects.toBeInstanceOf(MonthNotFoundError);
    expect(await countChildren(nov.id)).toEqual({ incomes: 0, lines: 0, actuals: 0 });
    expect((await getMonthList(userId)).map((m) => m.id)).toEqual([dec.id]);

    const decWs = await getMonthWorkspace(userId, 2026, 12);
    expect(decWs.incomes).toHaveLength(1);
    expect(decWs.actuals).toHaveLength(1);
    expect(decWs.lines).toHaveLength(3);

    const search = await searchActuals(userId, "Ticket");
    expect(search.status).toBe("empty");
  });

  it("#59 re-creating the month after delete clones TODAY's templates for month 11", async () => {
    const userId = await seedUser("google-sub-uc27-recreate");
    const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
    const rent = await createTemplate(userId, {
      categoryId: housing.id,
      name: "Rent",
      amount: "700.00",
      kind: "committed",
    });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    await deleteMonth(userId, { monthId: nov.id });

    // Templates changed after the original creation.
    await updateTemplate(userId, {
      id: rent.id,
      categoryId: housing.id,
      name: "Rent",
      amount: "750.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: housing.id,
      name: "Heating",
      amount: "90.00",
      kind: "estimated",
      months: [11, 12, 1],
    });
    await createTemplate(userId, {
      categoryId: housing.id,
      name: "Pool",
      amount: "30.00",
      kind: "committed",
      months: [6, 7],
    });

    const again = await createMonth(userId, { year: 2026, month: 11 });
    expect(again.id).not.toBe(nov.id);
    const ws = await getMonthWorkspace(userId, 2026, 11);
    const lines = ws.lines.map((l) => [l.name, l.originalAmount]).sort();
    expect(lines).toEqual([
      ["Heating", "90.00"],
      ["Rent", "750.00"],
    ]);
  });

  it("#61 tenancy: user B cannot delete user A's month and nothing of A's is removed", async () => {
    const userA = await seedUser("google-sub-uc27-a");
    const userB = await seedUser("google-sub-uc27-b");
    const { nov } = await seedNovDec(userA);

    await expect(deleteMonth(userB, { monthId: nov.id })).rejects.toBeInstanceOf(
      MonthNotFoundError,
    );

    expect(await countChildren(nov.id)).toEqual({ incomes: 2, lines: 5, actuals: 7 });
    expect(await getMonthList(userA)).toHaveLength(2);
  });

  it("throws MonthNotFoundError for an unknown id", async () => {
    const userId = await seedUser("google-sub-uc27-unknown");
    await expect(
      deleteMonth(userId, { monthId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
  });

  it("does not touch templates, categories or annuals", async () => {
    const userId = await seedUser("google-sub-uc27-catalogs");
    const { nov } = await seedNovDec(userId);
    const before = await countCatalogs(userId);
    await deleteMonth(userId, { monthId: nov.id });
    expect(await countCatalogs(userId)).toEqual(before);
  });
});

async function seedNovDec(userId: string) {
  const food = await createCategory(userId, { kind: "expense", name: "Food" });
  const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
  const salary = await createCategory(userId, { kind: "income", name: "Salary" });
  for (const [name, amount, kind] of [
    ["Rent", "700.00", "committed"],
    ["Internet", "30.00", "committed"],
    ["Groceries", "300.00", "estimated"],
  ] as const) {
    await createTemplate(userId, { categoryId: housing.id, name, amount, kind });
  }
  const nov = await createMonth(userId, { year: 2026, month: 11 });
  const dec = await createMonth(userId, { year: 2026, month: 12 });

  // Nov: 2 incomes, 3 cloned + 2 month-only lines = 5, 7 actuals.
  for (const name of ["Salary", "Bonus"]) {
    await addIncome(userId, { monthId: nov.id, categoryId: salary.id, name, amount: "1000.00" });
  }
  for (const name of ["Gift", "Repair"]) {
    await addMonthOnlyLine(userId, {
      monthId: nov.id,
      categoryId: food.id,
      name,
      amount: "20.00",
      kind: "estimated",
    });
  }
  for (let i = 1; i <= 7; i++) {
    await addActual(userId, {
      monthId: nov.id,
      categoryId: food.id,
      name: `Ticket ${i}`,
      amount: "5.00",
    });
  }

  // Dec: 1 income, 3 cloned lines, 1 actual.
  await addIncome(userId, { monthId: dec.id, categoryId: salary.id, name: "Salary", amount: "1000.00" });
  await addActual(userId, { monthId: dec.id, categoryId: food.id, name: "Bread", amount: "2.00" });
  return { nov, dec };
}

async function countChildren(monthId: string) {
  const [row] = await db.execute<{ incomes: number; lines: number; actuals: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM month_income WHERE month_id = ${monthId}) AS incomes,
      (SELECT count(*)::int FROM month_fixed_line WHERE month_id = ${monthId}) AS lines,
      (SELECT count(*)::int FROM month_actual_expense WHERE month_id = ${monthId}) AS actuals
  `);
  return row;
}

async function countCatalogs(userId: string) {
  const [row] = await db.execute<{ templates: number; categories: number; annuals: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM template WHERE user_id = ${userId}) AS templates,
      (SELECT count(*)::int FROM category WHERE user_id = ${userId}) AS categories,
      (SELECT count(*)::int FROM annual WHERE user_id = ${userId}) AS annuals
  `);
  return row;
}

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
      `[integration] Postgres unreachable, skipping UC-27 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
