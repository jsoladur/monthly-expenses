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
// Every function takes `workspaceId` first and filters `month.workspace_id` (PRD §5.1).
// Drizzle `sum()` on numeric comes back as a string; parse via integer cents.
//
// UC-24 (C24): spend and remaining series cover NON-savings categories only;
// the invested series cover savings categories. Per-category spend keeps
// every expense category and carries the flag so a savings category can
// still be charted when the user selects it.
// ============================================================================

export type GlobalStatsAggregates = {
  presence: MonthKey[];
  incomeByMonth: MonthCents[];
  spendByMonth: MonthCents[];
  remainingByMonth: MonthCents[];
  investedByMonth: MonthCents[];
  investedRemainingByMonth: MonthCents[];
  incomeByCategoryMonth: MonthCategoryCents[];
  spendByCategoryMonth: MonthCategoryCents[];
};

export async function loadGlobalStatsAggregates(
  workspaceId: string,
): Promise<GlobalStatsAggregates> {
  const [
    presence,
    incomeByMonth,
    spendByMonth,
    remainingByMonth,
    investedByMonth,
    investedRemainingByMonth,
    incomeByCategoryMonth,
    spendByCategoryMonth,
  ] = await Promise.all([
    listMonthPresence(workspaceId),
    sumIncomeByMonth(workspaceId),
    sumSpendByMonth(workspaceId),
    sumRemainingByMonth(workspaceId),
    sumInvestedByMonth(workspaceId),
    sumInvestedRemainingByMonth(workspaceId),
    sumIncomeByCategoryMonth(workspaceId),
    sumSpendByCategoryMonth(workspaceId),
  ]);
  return {
    presence,
    incomeByMonth,
    spendByMonth,
    remainingByMonth,
    investedByMonth,
    investedRemainingByMonth,
    incomeByCategoryMonth,
    spendByCategoryMonth,
  };
}

export async function listMonthPresence(workspaceId: string): Promise<MonthKey[]> {
  return db
    .select({ year: month.year, month: month.month })
    .from(month)
    .where(eq(month.workspaceId, workspaceId))
    .orderBy(asc(month.year), asc(month.month));
}

export async function sumIncomeByMonth(workspaceId: string): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthIncome.amount).as("total"),
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .where(eq(month.workspaceId, workspaceId))
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

export async function sumSpendByMonth(workspaceId: string): Promise<MonthCents[]> {
  return sumActualsByMonth(workspaceId, false);
}

export async function sumInvestedByMonth(workspaceId: string): Promise<MonthCents[]> {
  return sumActualsByMonth(workspaceId, true);
}

export async function sumRemainingByMonth(workspaceId: string): Promise<MonthCents[]> {
  return sumLineRemainingByMonth(workspaceId, false);
}

export async function sumInvestedRemainingByMonth(workspaceId: string): Promise<MonthCents[]> {
  return sumLineRemainingByMonth(workspaceId, true);
}

async function sumActualsByMonth(workspaceId: string, savings: boolean): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(
      and(
        eq(month.workspaceId, workspaceId),
        eq(category.workspaceId, workspaceId),
        eq(category.countsAsSavings, savings),
      ),
    )
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

async function sumLineRemainingByMonth(workspaceId: string, savings: boolean): Promise<MonthCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      total: sum(monthFixedLine.remainingAmount).as("total"),
    })
    .from(monthFixedLine)
    .innerJoin(month, eq(monthFixedLine.monthId, month.id))
    .innerJoin(category, eq(monthFixedLine.categoryId, category.id))
    .where(
      and(
        eq(month.workspaceId, workspaceId),
        eq(category.workspaceId, workspaceId),
        eq(category.countsAsSavings, savings),
      ),
    )
    .groupBy(month.year, month.month)
    .orderBy(asc(month.year), asc(month.month));
  return rows.map((r) => ({ year: r.year, month: r.month, cents: numericSumToCents(r.total) }));
}

export async function sumIncomeByCategoryMonth(workspaceId: string): Promise<MonthCategoryCents[]> {
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
    .where(and(eq(month.workspaceId, workspaceId), eq(category.workspaceId, workspaceId)))
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

export async function sumSpendByCategoryMonth(workspaceId: string): Promise<MonthCategoryCents[]> {
  const rows = await db
    .select({
      year: month.year,
      month: month.month,
      categoryId: category.id,
      categoryName: category.name,
      categoryKind: category.kind,
      categoryActive: category.active,
      countsAsSavings: category.countsAsSavings,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(and(eq(month.workspaceId, workspaceId), eq(category.workspaceId, workspaceId)))
    .groupBy(
      month.year,
      month.month,
      category.id,
      category.name,
      category.kind,
      category.active,
      category.countsAsSavings,
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
  countsAsSavings?: boolean;
  total: string | null;
}): MonthCategoryCents {
  return {
    year: row.year,
    month: row.month,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categoryKind: row.categoryKind,
    categoryActive: row.categoryActive,
    countsAsSavings: row.countsAsSavings ?? false,
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
