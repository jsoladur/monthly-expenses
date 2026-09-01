import "server-only";
import { and, asc, eq, sum } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  category,
  month,
  monthActualExpense,
  monthFixedLine,
  monthIncome,
} from "@/server/db/schema";
import { parseAmount } from "@/server/money";
import type {
  MonthCategoryCents,
  MonthCents,
  MonthKey,
} from "@/server/services/global-stats-formulas";

// ============================================================================
// Global Stats repository (UC-15). Aggregated series only — SQL SUM / GROUP BY.
// Every function takes `userId` first and filters `month.user_id` (PRD §5.1).
// Drizzle `sum()` on numeric comes back as a string; parse via integer cents.
// ============================================================================

export type GlobalStatsAggregates = {
  presence: MonthKey[];
  incomeByMonth: MonthCents[];
  spendByMonth: MonthCents[];
  remainingByMonth: MonthCents[];
  incomeByCategoryMonth: MonthCategoryCents[];
  spendByCategoryMonth: MonthCategoryCents[];
};

export async function loadGlobalStatsAggregates(
  userId: string,
): Promise<GlobalStatsAggregates> {
  const [
    presence,
    incomeByMonth,
    spendByMonth,
    remainingByMonth,
    incomeByCategoryMonth,
    spendByCategoryMonth,
  ] = await Promise.all([
    listMonthPresence(userId),
    sumIncomeByMonth(userId),
    sumSpendByMonth(userId),
    sumRemainingByMonth(userId),
    sumIncomeByCategoryMonth(userId),
    sumSpendByCategoryMonth(userId),
  ]);
  return {
    presence,
    incomeByMonth,
    spendByMonth,
    remainingByMonth,
    incomeByCategoryMonth,
    spendByCategoryMonth,
  };
}

export async function listMonthPresence(userId: string): Promise<MonthKey[]> {
  return db
    .select({ year: month.year, month: month.month })
    .from(month)
    .where(eq(month.userId, userId))
    .orderBy(asc(month.year), asc(month.month));
}

export async function sumIncomeByMonth(userId: string): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthIncome.amount).as("total"),
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .where(eq(month.userId, userId))
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

export async function sumSpendByMonth(userId: string): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .where(eq(month.userId, userId))
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

export async function sumRemainingByMonth(userId: string): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthFixedLine.remainingAmount).as("total"),
    })
    .from(monthFixedLine)
    .innerJoin(month, eq(monthFixedLine.monthId, month.id))
    .where(eq(month.userId, userId))
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

export async function sumIncomeByCategoryMonth(userId: string): Promise<MonthCategoryCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      categoryId: category.id,
      categoryName: category.name,
      categoryKind: category.kind,
      categoryActive: category.active,
      total: sum(monthIncome.amount).as("total"),
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .innerJoin(category, eq(monthIncome.categoryId, category.id))
    .where(and(eq(month.userId, userId), eq(category.userId, userId)))
    .groupBy(
      month.year,
      month.month,
      category.id,
      category.name,
      category.kind,
      category.active,
    )
    .orderBy(asc(month.year), asc(month.month));
  return rows.map(toCategoryCents);
}

export async function sumSpendByCategoryMonth(userId: string): Promise<MonthCategoryCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      categoryId: category.id,
      categoryName: category.name,
      categoryKind: category.kind,
      categoryActive: category.active,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(and(eq(month.userId, userId), eq(category.userId, userId)))
    .groupBy(
      month.year,
      month.month,
      category.id,
      category.name,
      category.kind,
      category.active,
    )
    .orderBy(asc(month.year), asc(month.month));
  return rows.map(toCategoryCents);
}

function toCategoryCents(row: {
  year: number;
  month: number;
  categoryId: string;
  categoryName: string;
  categoryKind: "income" | "expense";
  categoryActive: boolean;
  total: string | null;
}): MonthCategoryCents {
  return {
    year: row.year,
    month: row.month,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryKind: row.categoryKind,
    categoryActive: row.categoryActive,
    cents: numericSumToCents(row.total),
  };
}

/** Postgres/Drizzle `sum(numeric)` → integer cents. Never float. */
function numericSumToCents(raw: string | null): number {
  if (raw === null) return 0;
  const trimmed = raw.trim();
  if (/^-?\d{1,12}\.\d{2}$/.test(trimmed)) {
    return parseAmount(trimmed);
  }
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ""] = digits.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const frac = (fracRaw + "00").slice(0, 2);
  return parseAmount(`${negative ? "-" : ""}${whole}.${frac}`);
}
