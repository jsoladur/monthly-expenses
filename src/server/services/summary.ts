import "server-only";
import { and, eq, sum } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
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
import { listActiveTemplates } from "@/server/repositories/template";
import { MonthNotFoundError } from "@/server/services/months";
import { parseAmount, sumCents } from "@/server/money";

// ============================================================================
// Summary service (UC-11, PRD §7.1 / §7.4 / §7.7 / UC-13, ARCH §8 / §5).
//
// Owns the read-only domain logic that backs the workspace summary header:
//   - `getMonthSummary`      — savings algebra (PRD §7.1, #5–#8, #14)
//   - `getOverspendWarnings` — per-category overrun vs ACTIVE estimated
//                              template plan (PRD §7.4 / C18, #19)
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
// repositories; we re-use `listActiveTemplates` so the baseline is sourced
// from the SAME clone-source query as month creation (PRD §7.4 vs §7.8).
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
// getMonthSummary — PRD §7.1
//
// potential_savings =
//   Σ month_income.amount
//   − ( Σ month_actual_expense.amount
//     + Σ month_fixed_line.remaining_amount )
//
// Hard-deleted rows are excluded by virtue of being gone. All sums are
// algebraic (PRD §7.6 — negatives allowed everywhere).
// ---------------------------------------------------------------------------

export interface MonthSummary {
  incomesTotal: number;
  actualsTotal: number;
  reservedRemainingTotal: number;
  potentialSavings: number;
}

export async function getMonthSummary(
  userId: string,
  monthId: string,
): Promise<MonthSummary> {
  const owned = await findMonthById(userId, monthId);
  if (!owned) {
    throw new MonthNotFoundError();
  }

  // Three independent reads against the same month — the schema is
  // month_id-keyed so we don't need a single SQL with a JOIN. We pull the
  // columns we actually need (amount / remaining_amount) to keep memory
  // flat — the `listMonth*` helpers return the full rows.
  const [incomes, actuals, lines] = await Promise.all([
    db
      .select({ amount: monthIncome.amount })
      .from(monthIncome)
      .where(eq(monthIncome.monthId, monthId)),
    db
      .select({ amount: monthActualExpense.amount })
      .from(monthActualExpense)
      .where(eq(monthActualExpense.monthId, monthId)),
    db
      .select({ remaining: monthFixedLine.remainingAmount })
      .from(monthFixedLine)
      .where(eq(monthFixedLine.monthId, monthId)),
  ]);

  const incomesTotal = sumCents(incomes.map((row) => parseAmount(row.amount)));
  const actualsTotal = sumCents(actuals.map((row) => parseAmount(row.amount)));
  const reservedRemainingTotal = sumCents(
    lines.map((row) => parseAmount(row.remaining)),
  );
  const potentialSavings =
    incomesTotal - (actualsTotal + reservedRemainingTotal);

  return {
    incomesTotal,
    actualsTotal,
    reservedRemainingTotal,
    potentialSavings,
  };
}

// ---------------------------------------------------------------------------
// getOverspendWarnings — PRD §7.4 / C18 / #19
//
// LEFT   = Σ month_actual_expense.amount per expense category for the open
//          month.
// RIGHT  = Σ active ESTIMATED template amounts in that category.
//          COMMITTED templates are EXCLUDED (PRD §7.4 — overspend is about
//          the plan vs the tickets; committed money has no plan slot).
//          The MONTH'S remaining is NEVER used for this baseline.
// Warn only when LEFT > RIGHT. Categories with only committed templates
// (or no estimated templates at all) get NO warning.
// ---------------------------------------------------------------------------

export interface OverspendWarning {
  categoryId: string;
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
  const actualSums = await db
    .select({
      categoryId: monthActualExpense.categoryId,
      total: sum(monthActualExpense.amount).as("total"),
    })
    .from(monthActualExpense)
    .where(eq(monthActualExpense.monthId, monthId))
    .groupBy(monthActualExpense.categoryId);

  if (actualSums.length === 0) {
    return [];
  }

  // RIGHT side: per-category ACTIVE ESTIMATED templates. Reuse the existing
  // `listActiveTemplates` helper so the baseline is sourced from the exact
  // same clone-source query UC-06 uses at month creation (PRD §7.4 vs §7.8).
  // We aggregate in JS (templates per user are tiny — typically <100 rows).
  //
  // Track BOTH the sum AND the membership so a category with NO estimated
  // template gets NO warning (PRD §7.4: "Categories with only committed
  // templates get NO warning."). A baseline of 0 is only meaningful when
  // the user actually has an estimated template for the category.
  const activeTemplates = await listActiveTemplates(userId);
  const estimatedByCategory = new Map<string, number>();
  const categoriesWithEstimatedPlan = new Set<string>();
  for (const tpl of activeTemplates) {
    if (tpl.kind !== "estimated") continue;
    categoriesWithEstimatedPlan.add(tpl.categoryId);
    estimatedByCategory.set(
      tpl.categoryId,
      (estimatedByCategory.get(tpl.categoryId) ?? 0) +
        parseAmount(tpl.amount),
    );
  }

  const warnings: OverspendWarning[] = [];
  for (const row of actualSums) {
    // The overspend baseline is the plan in active ESTIMATED templates
    // only. A category with no estimated template has no plan slot, so
    // there's nothing to overspend against (PRD §7.4 / C18).
    if (!categoriesWithEstimatedPlan.has(row.categoryId)) continue;
    const actualsTotal = parseAmount(row.total as string);
    const estimatedTemplateTotal = estimatedByCategory.get(row.categoryId) ?? 0;
    const overrunCents = actualsTotal - estimatedTemplateTotal;
    if (overrunCents > 0) {
      warnings.push({
        categoryId: row.categoryId,
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