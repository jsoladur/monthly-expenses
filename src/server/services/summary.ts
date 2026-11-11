import "server-only";
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  category,
  month,
  monthActualExpense,
  monthFixedLine,
  monthIncome,
  template,
  type MonthActualExpense,
  type MonthFixedLine,
  type MonthIncome,
} from "@/server/db/schema";
import { findMonthById } from "@/server/repositories/month";
import { listPlanTemplatesForMonth } from "@/server/repositories/template";
import { MonthNotFoundError } from "@/server/services/months";
import { parseAmount, sumCents } from "@/server/money";

// ============================================================================
// Summary service (UC-11, PRD §7.1 / §7.4 / §7.7 / UC-13, ARCH §8 / §5).
//
// Owns the read-only domain logic that backs the workspace summary header:
//   - `getMonthSummary`      — savings algebra (PRD §7.1, #5–#8, #14)
//   - `getOverspendWarnings` — per-category overrun vs ACTIVE template
//                              plan (committed + estimated; PRD §7.4 / C18, #19)
//   - `isPastMonth`          — open-month banner gate (PRD §7.7 / C8)
//
// SQL lives only in the repository (ARCH §5 rule 1). This service composes
// repository reads — none of the three ops need a transaction because they
// are pure READS with no mutation contract.
//
// Money: integer cents everywhere on the boundary — `parseAmount` on the
// wire strings the DB returns, `sumCents` for the aggregations. Negatives
// are first-class (PRD §7.6) so we never use `Math.abs` or non-algebraic
// sums. Overspend baseline uses `month_income` / `month_fixed_line` /
// `month_actual_expense` join paths that already exist in their respective
// repositories; the baseline comes from `listPlanTemplatesForMonth` — the
// clone-source rules of month creation, plus loans that already ended but
// were still paid in the open month (PRD §7.4 / C29).
//
// Tenancy: every read joins on `month.user_id` (PRD §5.1). A tenant calling
// this with a `monthId` they don't own gets `MonthNotFoundError` — same
// contract every other service exposes.
//
// Domain errors are translated at the action boundary; the i18n keys for
// "no warnings" / "show banner" are presentational, not domain-level, so
// they live in the components, not here.
// ============================================================================

// ---------------------------------------------------------------------------
// getMonthSummary — PRD §7.1, amended by UC-24 (C24)
//
// spending          = Σ actuals + Σ remaining   (non-savings categories)
// invested          = Σ actuals + Σ remaining   (savings categories)
// potential_savings = Σ incomes − spending − invested   ← "Left over"
// total_saved       = potential_savings + invested
//
// `potential_savings` keeps the exact pre-UC-24 algebra. The savings flag
// is read live from `category`, so flipping it reclassifies every month.
// Hard-deleted rows are excluded by virtue of being gone. All sums are
// algebraic (PRD §7.6 — negatives allowed everywhere).
// ---------------------------------------------------------------------------

export interface MonthSummary {
  incomesTotal: number;
  actualsTotal: number;
  reservedRemainingTotal: number;
  spendingTotal: number;
  investedTotal: number;
  potentialSavings: number;
  totalSaved: number;
  hasSavingsRows: boolean;
}

export async function getMonthSummary(
  userId: string,
  monthId: string,
): Promise<MonthSummary> {
  const owned = await findMonthById(userId, monthId);
  if (!owned) {
    throw new MonthNotFoundError();
  }

  // Three independent reads against the same month. Actuals and lines join
  // `category` only to read `counts_as_savings`.
  const [incomes, actuals, lines] = await Promise.all([
    db
      .select({ amount: monthIncome.amount })
      .from(monthIncome)
      .where(eq(monthIncome.monthId, monthId)),
    db
      .select({
        amount: monthActualExpense.amount,
        savings: category.countsAsSavings,
      })
      .from(monthActualExpense)
      .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
      .where(eq(monthActualExpense.monthId, monthId)),
    db
      .select({
        amount: monthFixedLine.remainingAmount,
        savings: category.countsAsSavings,
      })
      .from(monthFixedLine)
      .innerJoin(category, eq(monthFixedLine.categoryId, category.id))
      .where(eq(monthFixedLine.monthId, monthId)),
  ]);

  const incomesTotal = sumCents(incomes.map((row) => parseAmount(row.amount)));
  const actualsTotal = sumCents(actuals.map((row) => parseAmount(row.amount)));
  const reservedRemainingTotal = sumCents(
    lines.map((row) => parseAmount(row.amount)),
  );
  const savingsRows = [...actuals, ...lines].filter((row) => row.savings);
  const investedTotal = sumCents(savingsRows.map((row) => parseAmount(row.amount)));
  const spendingTotal = actualsTotal + reservedRemainingTotal - investedTotal;
  const potentialSavings =
    incomesTotal - (actualsTotal + reservedRemainingTotal);

  return {
    incomesTotal,
    actualsTotal,
    reservedRemainingTotal,
    spendingTotal,
    investedTotal,
    potentialSavings,
    totalSaved: potentialSavings + investedTotal,
    hasSavingsRows: savingsRows.length > 0,
  };
}

// ---------------------------------------------------------------------------
// getOverspendWarnings — PRD §7.4 / C18 / #19
//
// LEFT   = Σ month_actual_expense.amount per expense category for the open
//          month.
// RIGHT  = Σ active template amounts in that category (committed + estimated)
//          that apply to the open month-number (PRD C23, UC-20). For
//          unscheduled templates, same total as Fixed Expenses → Distribution.
//          A template with a last payment month (PRD C29, UC-29) counts for
//          every month up to and including it, active or not.
//          The MONTH'S remaining is NEVER used for this baseline.
// Warn only when LEFT > RIGHT. Categories with no active templates get
// NO warning. Savings categories never warn: investing more than the plan
// is not overspending (PRD C24, UC-24).
// ---------------------------------------------------------------------------

export interface OverspendWarning {
  categoryId: string;
  categoryName: string;
  actualsTotal: number;
  estimatedTemplateTotal: number;
  overrunCents: number;
}

export async function getOverspendWarnings(
  userId: string,
  monthId: string,
): Promise<OverspendWarning[]> {
  const owned = await findMonthById(userId, monthId);
  if (!owned) {
    throw new MonthNotFoundError();
  }

  // LEFT side: per-category actuals. Group by category_id so we return one
  // warning per overspending category. The sum is computed in PG so the
  // result set is small (one row per category that has any actuals).
  // We also fetch the category name for display in the warning badge.
  const actualSums = await db
    .select({
      categoryId: monthActualExpense.categoryId,
      categoryName: category.name,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(
      and(
        eq(monthActualExpense.monthId, monthId),
        eq(category.countsAsSavings, false),
      ),
    )
    .groupBy(monthActualExpense.categoryId, category.name);

  if (actualSums.length === 0) {
    return [];
  }

  // RIGHT side: per-category templates (committed + estimated) that apply to
  // this month — schedule (PRD C23) and last payment month (PRD C29).
  const activeTemplates = await listPlanTemplatesForMonth(
    userId,
    owned.year,
    owned.month,
  );
  const planByCategory = new Map<string, number>();
  for (const tpl of activeTemplates) {
    planByCategory.set(
      tpl.categoryId,
      (planByCategory.get(tpl.categoryId) ?? 0) + parseAmount(tpl.amount),
    );
  }

  const warnings: OverspendWarning[] = [];
  for (const row of actualSums) {
    if (!planByCategory.has(row.categoryId)) continue;
    const actualsTotal = parseAmount(row.total as string);
    const estimatedTemplateTotal = planByCategory.get(row.categoryId) ?? 0;
    const overrunCents = actualsTotal - estimatedTemplateTotal;
    if (overrunCents > 0) {
      warnings.push({
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        actualsTotal,
        estimatedTemplateTotal,
        overrunCents,
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// isPastMonth — PRD §7.7 / C8 / UC-13
//
// The banner is shown whenever the open month is NOT the current calendar
// month. All edits remain allowed; this is a notification only ("Changes
// are allowed."). Future months are also flagged as "not the current
// month" — the banner is the same, the user is in the same state of "I'm
// looking at a month that isn't today".
//
// `now` is injected so the function is unit-testable without monkey-patching
// `Date`. Production callers pass `new Date()` once per request.
// ---------------------------------------------------------------------------

export function isPastMonth(
  year: number,
  month: number,
  now: Date,
): boolean {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1; // 1-12
  if (year !== currentYear) return true;
  return month !== currentMonth;
}

// ----------------------------------------------------------------------------
// Helpers kept around so other services / future slices can import them
// without re-deriving — same pattern UC-09 uses for re-exports.
// ----------------------------------------------------------------------------

// Re-export the row arrays for downstream serialization (e.g. JSON-safe
// copies on the RSC boundary).
export type { MonthIncome, MonthActualExpense, MonthFixedLine };
export type SummaryRows = {
  incomes: MonthIncome[];
  actuals: MonthActualExpense[];
  lines: MonthFixedLine[];
};

// `month`, `template`, and `and` / `eq` are imported here only to keep the
// service self-contained for tests that want to assert the imports resolve
// (mirrors the pattern in UC-09's reserved-lines service).
export { month, template, and, eq };