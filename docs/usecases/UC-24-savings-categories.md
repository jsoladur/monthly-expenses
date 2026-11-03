# UC-24 — Savings categories (investments that are not spending)

> **Database:** **adds one column** — `category.counts_as_savings boolean NOT NULL DEFAULT false`, via migration 0006. Product Owner decision 2026-11-03 (review of shipped features).
> **PRD refs:** proposed **UC-26** / **C24**; amends §6.2, §7.1, §7.4, §19. Screens 4, 5 and 13 (PRD §10). Until merged into `docs/prds/GLOBAL.md`, **this file is the behavior source of truth**.
> **ARCH refs:** §4 (data model), §5 (layering), §8 (money in integer cents).
> **Touches:** UC-03 (categories), UC-11 (summary + overspend), UC-15 (Global Stats), UC-19 (Excel export), month-workspace Stats tab.

## 0. Why this exists

The user records retirement-plan contributions and index-fund purchases under an expense category ("Investment"). They are correctly **not available** to spend that month, but they are **not consumption**. Today every surface treats them as spending:

- Month summary: "Potential savings" understates what the household actually saved.
- Global Stats: a higher contribution reads as household cost-of-living inflation, inflates spend growth, lowers the savings rate and can trigger `savingsRateDrop` / `deficitYear` insights and category-creep flags.
- Overspend: investing more than planned raises an amber warning.

## 1. Goal

An expense category can be marked **Counts as savings**. Money in such a category keeps being recorded exactly as today (templates, reserved lines, actuals, pass-to-actual, pass-to-upcoming, annuals) and keeps leaving the "available" money. Only **reporting** separates it from spending.

## 2. Out of scope

- Line-level flags (on a template, line or actual). The classification lives on the category only.
- Portfolio tracking, returns, balances, asset values, or any external market data.
- Income categories (the flag is meaningless there; rejected server-side).
- A new line `kind`. `committed` / `estimated` are unchanged.

## 3. Data model

- `category.counts_as_savings boolean NOT NULL DEFAULT false`.
- Check constraint `category_savings_kind_ck`: `counts_as_savings = false OR kind = 'expense'`.
- Every pre-existing row reads `false` → zero behavior change until the user flips a category.
- **Reclassification is retroactive by design.** The flag is catalog metadata (like the category name, which already displays live on old rows), not a money row. Flipping it changes how every past and future month is *reported*; it never rewrites any amount. PRD §7.8 ("months never sync") is about money rows and is not affected.

## 4. Money rules (amends PRD §7.1)

Per month, split every expense amount by its category's flag:

```
spending         = Σ actuals (non-savings categories) + Σ remaining (non-savings categories)
invested         = Σ actuals (savings categories)     + Σ remaining (savings categories)
left_over        = Σ incomes − spending − invested      ← numerically identical to today's potential_savings
total_saved      = left_over + invested
```

- `left_over` keeps the exact PRD §7.1 algebra. Nothing that already reads "potential savings" changes value.
- Negatives stay algebraic (PRD §7.6). A negative actual in a savings category (e.g. a withdrawal) lowers `invested`.
- Soft-deleted categories keep their flag; their rows are still classified by it.

## 5. Overspend (amends PRD §7.4 / C18)

Categories with `counts_as_savings = true` raise **no** overspend warning. Investing more than the plan is not overspending.

## 6. Service changes

### 6.1 Categories (`src/server/services/categories.ts`)

- `createCategory` / `renameCategory` → accept optional `countsAsSavings` (expense only). A new `setCategorySavings(userId, { id, countsAsSavings })` toggles it. Income category + `true` → `SavingsOnIncomeCategoryError`. Missing / other tenant → `CategoryNotFoundError`.
- Repository: `updateCategorySavings(userId, id, value, tx)`; `listCategories` / `listActiveCategories` return the flag.

### 6.2 Summary (`src/server/services/summary.ts`)

- `getMonthSummary` returns `{ incomesTotal, spendingTotal, investedTotal, reservedRemainingTotal, actualsTotal, potentialSavings /* = left_over */, totalSaved }` in integer cents. The actual and remaining reads join `category` to read `counts_as_savings` (still month-scoped and tenant-checked through `findMonthById`).
- `getOverspendWarnings` skips savings categories.

### 6.3 Global Stats (`src/server/repositories/global-stats.ts`, `src/server/services/global-stats.ts`)

- `sumSpendByMonth`, `sumRemainingByMonth`, `sumSpendByCategoryMonth` exclude savings categories (filter `category.counts_as_savings = false`).
- New `sumInvestedByMonth(userId)` (actuals in savings categories; remaining handled like `remainingByMonth` when *project remaining* is on).
- Formulas (`global-stats-formulas.ts`):
  - `realizedSavings(income, spend)` stays `income − spend` with spend **excluding** investments → it now *includes* invested money, which is the honest definition.
  - Household cost change (HCC), spend growth, category creep and `hccAhead` use the reduced spend.
  - New series **Invested by year** on Overview (bars, same palette rules as existing series) and an `invested` figure next to realized savings.
  - Help tab glossary gains "Savings category" and "Invested".
- Category multi-select keeps listing savings categories; when one is selected the chart labels it "(savings)".

### 6.4 Excel export (`src/server/services/export.ts`)

- Summary block gains two rows under the existing ones: **Invested** and **Total saved**. Existing rows keep their labels and formulas; `Potential savings` is relabelled with the same key as the UI (see §8).

## 7. Server actions (`src/actions/categories.ts`)

- New `setCategorySavingsAction({ id, countsAsSavings })` → Zod (`uuid`, `boolean`) → service → `revalidatePath('/[locale]', 'layout')` (summary, stats and month workspace all read it).
- Error code: `"savingsOnIncomeCategory"`.

## 8. UI

- **Categories screen (expense tab only):** each row gets a switch **Counts as savings**, with help text "Money set aside (pension, index funds). It still leaves your available money, but it is not spending." Rows with the flag show a small `PiggyBank` (lucide) badge. The add-category form has the same switch, off by default.
- **Month summary block:** order Income · Spending · Invested · **Left over** · Total saved. "Invested" and "Total saved" render only when the month has at least one savings-category row (no visual noise for users who never use the feature). `Left over` is the relabelled "Potential savings" (PO default 2026-11-03; key `month.summary.savings` keeps its id, only the copy changes).
- **Month workspace Stats tab:** the spending pie excludes savings categories; a single "Invested" figure sits under the pie.
- **Overspend badges** never appear on savings categories.
- All colors from STYLE-GUIDE tokens; "Invested" uses the existing positive/success token, not a new hue.

## 9. i18n keys

- `categories.savings.{toggle, help, badge}`
- `month.summary.{spending, invested, totalSaved, totalSavedHelp}`; copy change on `month.summary.savings` / `savingsHelp` (en "Left over" / es "Sobrante")
- `stats.overview.invested.{title, help}`, `stats.help.{savingsCategory, invested}`
- `export.summary.{invested, totalSaved}`
- `validation.savingsOnIncomeCategory`

## 10. Acceptance criteria / tests (proposed PRD §15 #41–#46)

- #41 Income 3000; actuals Food 300; reserved Mortgage 800 (Housing); reserved Pension 500 (Investment, savings) → spending 1100, invested 500, left over 1400, total saved 1900. `potentialSavings` equals the pre-UC-24 value.
- #42 Flipping "Investment" to savings changes no stored amount and reclassifies every existing month on the next read; flipping back restores the old figures.
- #43 Investment template plan 500, actuals 600 → no overspend warning. Same numbers on a non-savings category → warning.
- #44 Global Stats: two years, spend 20 000 → 20 000 in normal categories, investments 3 000 → 6 000 → HCC = 0 %, invested series 3 000 → 6 000, savings rate rises, no `savingsRateDrop` insight.
- #45 Setting `counts_as_savings = true` on an income category is rejected (`SavingsOnIncomeCategoryError`; DB check also rejects it).
- #46 Tenancy: user B cannot toggle user A's category (`CategoryNotFoundError`); user B's flags never change user A's figures.

## 11. Depends on / unlocks

- Depends on: UC-03, UC-11, UC-15, UC-19.
- Unlocks: —
