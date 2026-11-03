# UC-22 — Month Stats data tables & category details

> **Status:** **DONE — shipped 2026-09-18** in 0.9.0 (commits `a2417ed`, `c114d79`), with the popup total fixed in 0.9.1 (`5135c74`). Retroactive slice written 2026-11-03 so the feature has a slice file; it documents existing behavior and asks for no new work.
> **Database:** **no schema change.** Read-only, built from the month's existing actuals and reserved lines.
> **PRD refs:** none (not in PRD v1). Extends the month-workspace Stats tab (screen 4, PRD §10). **This file is the behavior source of truth.**
> **ARCH refs:** §5 (RSC reads), §8 (integer cents), ADR-9 (shadcn).

## Goal

On the month workspace **Stats** tab, the user can read the numbers behind each pie and open any expense category to see the lines that make up its total.

## Behavior

1. **Show data table:** every pie chart has a "Show data table" accordion listing category names and amounts by expense type (actuals, estimated, committed).
2. **Expenses by category table:** each row has a **Show details** button that opens a dialog listing the category's lines for that month in three groups: **Actuals**, **Estimated** and **Committed**. Each line shows name, observations and amount (reserved lines use `remaining_amount`). Each group is sorted by amount, highest first.
3. A **total** line at the bottom of the dialog sums the category for that month (0.9.1).

## Implementation (as shipped)

- `src/app/[locale]/months/[year]/[month]/stats-category-types.ts`: pure `buildCategoryBreakdowns(actuals, reservedLines)` groups by category and sorts categories by total, highest first. Amounts are integer cents.
- `category-expense-details.tsx`: `CategoryExpenseDetailsDialog` (native `<dialog>`, `aria-labelledby` / `aria-describedby`, close button).
- `stats-screen.tsx`: accordions + details trigger; `page.tsx` passes the month's lines (tenant-scoped through the month workspace read).

## i18n keys

- `months.stats.{showDetails, detailsDescription, …}` plus the data-table toggle labels (en/es).

## Acceptance criteria / tests (as shipped)

- `tests/unit/stats-category.test.ts`: one category splits into actuals / estimated / committed; categories stay isolated and sort by total, highest first.
- `tests/e2e/months.spec.ts`: pies expose "Show data table" accordions; "Show details" opens the dialog with the category's lines and total.

## Depends on / unlocks

- Depends on: UC-08, UC-09, UC-11.
- Unlocks: —
