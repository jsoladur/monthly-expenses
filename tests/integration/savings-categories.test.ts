import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { category } from "@/server/db/schema";
import {
  CategoryNotFoundError,
  SavingsOnIncomeCategoryError,
  createCategory,
  setCategorySavings,
} from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addIncome } from "@/server/services/incomes";
import { addActual } from "@/server/services/actuals";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";
import { getMonthSummary, getOverspendWarnings } from "@/server/services/summary";
import { getGlobalStatsPage } from "@/server/services/global-stats";

// ============================================================================
// UC-24 savings categories — integration (proposed PRD §15 #41–#46, C24).
//
// Skipped (not failed) when Postgres is unreachable, like the other suites.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-24 savings categories", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#41 splits spending from invested; left over keeps the §7.1 value", async () => {
    const userId = await seedUser("google-sub-uc24-split");
    const { monthId, investment } = await seedSplitMonth(userId);

    const before = await getMonthSummary(userId, monthId);
    expect(before.potentialSavings).toBe(140_000);
    expect(before.investedTotal).toBe(0);
    expect(before.hasSavingsRows).toBe(false);

    await setCategorySavings(userId, { id: investment.id, countsAsSavings: true });

    const summary = await getMonthSummary(userId, monthId);
    expect(summary.incomesTotal).toBe(300_000);
    expect(summary.spendingTotal).toBe(110_000);
    expect(summary.investedTotal).toBe(50_000);
    expect(summary.potentialSavings).toBe(140_000);
    expect(summary.totalSaved).toBe(190_000);
    expect(summary.actualsTotal).toBe(30_000);
    expect(summary.reservedRemainingTotal).toBe(130_000);
    expect(summary.hasSavingsRows).toBe(true);
  });

  it("#41 a negative actual in a savings category lowers invested", async () => {
    const userId = await seedUser("google-sub-uc24-negative");
    const { monthId, investment } = await seedSplitMonth(userId);
    await setCategorySavings(userId, { id: investment.id, countsAsSavings: true });
    await addActual(userId, {
      monthId,
      categoryId: investment.id,
      name: "Withdrawal",
      amount: "-100.00",
    });

    const summary = await getMonthSummary(userId, monthId);
    expect(summary.investedTotal).toBe(40_000);
    expect(summary.potentialSavings).toBe(150_000);
    expect(summary.totalSaved).toBe(190_000);
  });

  it("#42 flipping the flag changes no stored amount and is reversible", async () => {
    const userId = await seedUser("google-sub-uc24-flip");
    const { monthId, investment } = await seedSplitMonth(userId);
    const snapshot = async () =>
      db.execute(sql`
        SELECT amount::text AS a FROM month_actual_expense
        UNION ALL SELECT remaining_amount::text FROM month_fixed_line
        UNION ALL SELECT amount::text FROM month_income
        ORDER BY 1`);
    const amountsBefore = await snapshot();
    const summaryBefore = await getMonthSummary(userId, monthId);

    await setCategorySavings(userId, { id: investment.id, countsAsSavings: true });
    expect(await snapshot()).toEqual(amountsBefore);
    expect((await getMonthSummary(userId, monthId)).investedTotal).toBe(50_000);

    await setCategorySavings(userId, { id: investment.id, countsAsSavings: false });
    expect(await getMonthSummary(userId, monthId)).toEqual(summaryBefore);
  });

  it("#42 a soft-deleted category keeps classifying its rows", async () => {
    const userId = await seedUser("google-sub-uc24-soft-deleted");
    const { monthId, investment } = await seedSplitMonth(userId);
    await setCategorySavings(userId, { id: investment.id, countsAsSavings: true });
    await db
      .update(category)
      .set({ active: false, deletedAt: sql`now()` })
      .where(sql`${category.id} = ${investment.id}`);
    expect((await getMonthSummary(userId, monthId)).investedTotal).toBe(50_000);
  });

  it("#43 savings categories raise no overspend warning", async () => {
    const userId = await seedUser("google-sub-uc24-overspend");
    const investment = await createCategory(userId, {
      kind: "expense",
      name: "Investment",
      countsAsSavings: true,
    });
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    for (const cat of [investment, food]) {
      await createTemplate(userId, {
        categoryId: cat.id,
        name: `${cat.name} plan`,
        amount: "500.00",
        kind: "estimated",
      });
    }
    const monthRow = await createMonth(userId, { year: 2026, month: 8 });
    for (const cat of [investment, food]) {
      await addActual(userId, {
        monthId: monthRow.id,
        categoryId: cat.id,
        name: "Ticket",
        amount: "600.00",
      });
    }

    const warnings = await getOverspendWarnings(userId, monthRow.id);
    expect(warnings.map((w) => w.categoryName)).toEqual(["Food"]);
  });

  it("#44 Global Stats excludes investments from spend and HCC", async () => {
    const userId = await seedUser("google-sub-uc24-stats");
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    const investment = await createCategory(userId, {
      kind: "expense",
      name: "Investment",
      countsAsSavings: true,
    });
    const plan: Array<[number, string, string]> = [
      [2024, "250.00", "500.00"],
      [2025, "500.00", "500.00"],
    ];
    for (const [year, invest, pay] of plan) {
      for (let m = 1; m <= 12; m++) {
        const monthRow = await createMonth(userId, { year, month: m });
        await addIncome(userId, {
          monthId: monthRow.id,
          categoryId: salary.id,
          name: "Pay",
          amount: (Number(pay) * 4).toFixed(2),
        });
        await addActual(userId, {
          monthId: monthRow.id,
          categoryId: food.id,
          name: "Food",
          amount: (20_000 / 12).toFixed(2),
        });
        await addActual(userId, {
          monthId: monthRow.id,
          categoryId: investment.id,
          name: "Index fund",
          amount: invest,
        });
      }
    }

    const now = new Date(Date.UTC(2026, 5, 1));
    const overview = await getGlobalStatsPage(
      userId,
      { tab: "overview", from: "2024", to: "2025" },
      now,
    );
    expect(overview.overview?.yearlySpend.map((r) => r.cents)).toEqual([
      2_000_004, 2_000_004,
    ]);
    expect(overview.overview?.yearlyInvested.map((r) => r.cents)).toEqual([
      300_000, 600_000,
    ]);
    expect(overview.overview?.investedCents).toBe(900_000);
    const rates = overview.overview!.savingsRateByYear.map((r) => r.tenths!);
    expect(rates[0]).toBe(rates[1]);

    const inflation = await getGlobalStatsPage(
      userId,
      { tab: "inflation", from: "2024", to: "2025" },
      now,
    );
    expect(inflation.inflation?.hccByYear.find((r) => r.year === 2025)?.tenths).toBe(0);

    const trends = await getGlobalStatsPage(
      userId,
      { tab: "trends", from: "2024", to: "2025" },
      now,
    );
    expect(trends.trends?.signals.some((s) => s.id === "savingsRateDrop")).toBe(false);
    expect(trends.trends?.signals.some((s) => s.categoryId === investment.id)).toBe(false);

    const expenses = await getGlobalStatsPage(
      userId,
      { tab: "expenses", from: "2024", to: "2025" },
      now,
    );
    expect(expenses.expenses?.ranking.map((r) => r.categoryId)).toEqual([food.id]);

    const drilled = await getGlobalStatsPage(
      userId,
      { tab: "expenses", from: "2024", to: "2025", category: investment.id },
      now,
    );
    expect(drilled.expenses?.ranking).toEqual([
      expect.objectContaining({ categoryId: investment.id, countsAsSavings: true }),
    ]);
  });

  it("#45 an income category cannot count as savings", async () => {
    const userId = await seedUser("google-sub-uc24-income");
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    await expect(
      setCategorySavings(userId, { id: salary.id, countsAsSavings: true }),
    ).rejects.toBeInstanceOf(SavingsOnIncomeCategoryError);
    await expect(
      createCategory(userId, { kind: "income", name: "Bonus", countsAsSavings: true }),
    ).rejects.toBeInstanceOf(SavingsOnIncomeCategoryError);
    await expect(
      db
        .update(category)
        .set({ countsAsSavings: true })
        .where(sql`${category.id} = ${salary.id}`),
    ).rejects.toThrow();
  });

  it("#46 tenancy: another user cannot toggle the flag or move the figures", async () => {
    const alice = await seedUser("google-sub-uc24-alice");
    const bob = await seedUser("google-sub-uc24-bob");
    const { monthId, investment } = await seedSplitMonth(alice);

    await expect(
      setCategorySavings(bob, { id: investment.id, countsAsSavings: true }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect((await getMonthSummary(alice, monthId)).investedTotal).toBe(0);

    const bobCat = await createCategory(bob, { kind: "expense", name: "Investment" });
    await setCategorySavings(bob, { id: bobCat.id, countsAsSavings: true });
    expect((await getMonthSummary(alice, monthId)).investedTotal).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// #41 fixture: income 3000; Food actual 300; Mortgage 800 (Housing) and
// Pension 500 (Investment) reserved. Investment starts as a plain category.
async function seedSplitMonth(userId: string) {
  const salary = await createCategory(userId, { kind: "income", name: "Salary" });
  const food = await createCategory(userId, { kind: "expense", name: "Food" });
  const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
  const investment = await createCategory(userId, { kind: "expense", name: "Investment" });
  const monthRow = await createMonth(userId, { year: 2026, month: 8 });
  await addIncome(userId, {
    monthId: monthRow.id,
    categoryId: salary.id,
    name: "Pay",
    amount: "3000.00",
  });
  await addActual(userId, {
    monthId: monthRow.id,
    categoryId: food.id,
    name: "Groceries",
    amount: "300.00",
  });
  await addMonthOnlyLine(userId, {
    monthId: monthRow.id,
    categoryId: housing.id,
    name: "Mortgage",
    amount: "800.00",
    kind: "committed",
  });
  await addMonthOnlyLine(userId, {
    monthId: monthRow.id,
    categoryId: investment.id,
    name: "Pension",
    amount: "500.00",
    kind: "committed",
  });
  return { monthId: monthRow.id, investment };
}

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  return id;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-24 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
