# UC-11 — Month summary, potential savings & warnings

> **Database:** already migrated (UC-00). Reads `month_income`, `month_actual_expense`, `month_fixed_line`, `template`. No schema changes.
> **PRD refs:** UC-13, UC-14 (summary); §7.1 (savings); §7.4 (overspend); §7.7 (past months); C8; C18. Screen 4 completed.
> **ARCH refs:** §8 (integer-cents algebra, normative).

## Goal

Complete the month workspace header: the potential-savings number visible from day one, per-category overspend warnings, and the past-month banner. Warn only — never block (PRD §7.4).

## Service (`src/server/services/summary.ts`)

- `getMonthSummary(userId, monthId)` → `{ incomesTotal, actualsTotal, reservedRemainingTotal, potentialSavings }`, all integer cents:
  `potential_savings = Σ incomes − ( Σ actuals + Σ remaining_amount of fixed/estimated lines )` (PRD §7.1). Hard-deleted rows are excluded by being gone.
- `getOverspendWarnings(userId, monthId)` → per expense category:
  - LEFT = `Σ actual tickets` in that category for the OPEN month.
  - RIGHT = `Σ amounts of ACTIVE templates` (committed + estimated) in that category — NEVER the month's remaining box (PRD §7.4, C18). Same total as Fixed Expenses distribution by category.
  - Warn when LEFT > RIGHT. Categories with no active templates get NO warning.
- `isPastMonth(year, month)` → open month ≠ current calendar month → persistent warning banner; all edits stay allowed (PRD §7.7, C8, UC-13).

## Routes / UI

- Workspace summary header: income total, actuals total, remaining reserved, potential savings (copy per PRD §19: "Income minus actual spend minus money still reserved in fixed/estimated lines.").
- Overspend badge on the affected category rows: "Actual tickets in this category are higher than the plan in your templates." (PRD §19).
- Past-month banner: "This month is not the current calendar month. Changes are allowed." (PRD §19).

## i18n keys

- `summary.*`, `warnings.pastMonth`, `warnings.overspend`

## Acceptance criteria / tests (PRD §15)

- #5 Mortgage 800 committed + groceries 400 estimated + income 2000 → savings 800 on day one.
- #6 Grocery ticket 50 with remaining untouched → savings 750 (double-count by design, PRD §7.3).
- #7 (with UC-09) Groceries remaining set to 350 → savings back to 800.
- #8 (with UC-10) Pass mortgage to actual → savings still 800; money only in actuals.
- #13 Editing July while in August → banner shown, edits persist.
- #14 (with UC-08) Actual of −20 raises savings by 20.
- #19 Food templates 400 + 50, actuals 500 → warning shown; the month remaining is ignored for this warning; nothing is blocked.

## Depends on

- UC-07, UC-08, UC-09 (and UC-10 for scenario #8).
