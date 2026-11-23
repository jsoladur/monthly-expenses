# UC-30 — Income name autocomplete (add-income form)

> **PRD status:** Product Owner decision 2026-11-23. Merged into `docs/prds/GLOBAL.md` as **UC-32** / C13 (updated). This file is the detailed implementation slice.
> **No schema change.** Query existing `month_income` rows joined to `month`. Do not add tables, columns, extensions, or generated search columns.
> **PRD refs:** C1 / C6 / C13 / C15, §5.1 (tenancy), §6.5 (incomes), §11 (i18n), UC-22 (add-actual autocomplete — same control).
> **ARCH refs:** §5 (RSC reads — this slice has **no mutations**), ADR-6, ADR-9, ADR-10.
> **Reuse first:** this slice is UC-17 applied to incomes. Everything UC-17 says about matching, caps, layout, interaction and a11y applies unchanged unless this file says otherwise.

---

## 0. Why this exists

Most incomes come back every month with the same name (payroll, rent received, a pension). Retyping them on a phone is friction for no gain.

> **Reuse an income name I already typed recently.**

---

## 1. Goal

On the month workspace Incomes tab, the add-income name input (`#new-income-name`) offers the same inline list of recent names as `#new-actual-name` (UC-17): after **two** folded characters, up to **five** names, prefix match, accent/case-folded, most recent first. Picking one fills the **name only**.

---

## 2. Window — decided

Same as UC-17: the **open month + the two previous calendar months** (`recentMonthWindow`). The Product Owner chose consistency with actuals over a longer window (2026-11-23). Twice-a-year incomes older than two months back are not suggested; this is accepted.

---

## 3. Out of scope

- Autocomplete on the **edit**-income name field.
- Suggesting actual-expense or reserved-line names on the income form, or income names on the actual form. Each form has its own corpus.
- Filling category or amount on select.
- Any change to Search (UC-16).

---

## 4. Query contract

Identical to UC-17 §4 except the table:

| Rule | Value |
| --- | --- |
| Table / column | `month_income.name` only |
| Tenancy (P0) | `month_income` has no `user_id`; every read joins `month` and filters `month.user_id = userId` |
| Window | open month + 2 previous (missing months contribute nothing, C6) |
| Unique | per folded name, newest `created_at` spelling wins |
| Order | newest first |
| Caps | 5 shown · 200 corpus · read at most 1000 rows |
| Hard-deleted incomes | absent (C15) |

---

## 5. Layering

| Layer | Responsibility |
| --- | --- |
| Repository `listRecentIncomeNames(userId, periods)` in `src/server/repositories/income.ts` | SQL only, `userId` first. Shares the "unique on folded name, cap 200" step with `listRecentActualNames` via `uniqueRecentNames` in `src/lib/actual-name-suggestions.ts`. |
| Service `listRecentIncomeNameSuggestions(userId, year, month)` in `src/server/services/incomes.ts` | Builds the window, calls the repository. |
| Route `page.tsx` | Loads the corpus in the existing `Promise.all`; passes `nameSuggestions` to `IncomesScreen`. |
| Client | `#new-income-name` uses the shared `NameAutocomplete` combobox (renamed from `ActualNameAutocomplete`), with the `incomes.autocomplete` messages. |

---

## 6. i18n

| Key | en | es |
| --- | --- | --- |
| `incomes.autocomplete.listLabel` | Recent names | Nombres recientes |
| `incomes.autocomplete.a11y.suggestions` | {count, plural, one {# recent name} other {# recent names}} | {count, plural, one {# nombre reciente} other {# nombres recientes}} |

---

## 7. Acceptance criteria / tests

Mapped PRD §15 scenarios: **#74, #75, #76**.

### Integration (real Postgres) — `tests/integration/income-name-suggestions.test.ts`

1. User B's income corpus contains none of User A's income names (**#75**).
2. Open August: a June income is in the corpus; a May income is not (**#74**).
3. Duplicate folded names collapse to the newest spelling.
4. Actuals and reserved lines with other names are **not** in the income corpus (**#74**); income names are not in the actual corpus.
5. A hard-deleted income disappears from the corpus.

### E2E (Playwright) — `tests/e2e/income-name-autocomplete.spec.ts`

6. Open August Incomes, seed June "Nómina" + July "Nómina extra" + May "Nominal bonus" + an August actual "Nómina gift". Type `nó` → Nómina and Nómina extra shown; May income and the actual absent (**#74**).
7. One character → no listbox; tap Nómina → input filled, amount empty; Add creates the income (**#76**).
8. Spanish list label is "Nombres recientes".

### Quality

Typecheck + lint clean; i18n parity; no `userId`-less repository call. Existing UC-17 tests stay green.

---

## Depends on

- **UC-07** (incomes + add form), **UC-17** (autocomplete helpers and combobox).
- **No schema change.**
