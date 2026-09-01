# UC-15 — Global Stats (multi-year household analysis)

> **PRD status:** NOT in PRD v1. This slice **is** the “later” promised by PRD C16 / §14 (“Reports (year view, category totals, charts) — future”) and §17 (“Reports: Not V1; future yes.”). Product Owner decision **2026-09-01**. Until merged into `docs/prds/GLOBAL.md` (§9 use cases, §10 screens, C16), **this file is the behavior source of truth** for Global Stats.
> **No schema change.** All series are aggregated from existing `month`, `month_income`, `month_actual_expense`, `month_fixed_line`, and `category` rows. Do not add tables, columns, or a CPI feed.
> **PRD refs (extended):** C1/C9/C16, §5.1 (tenancy), §7.1 (savings algebra), §7.6 (negatives), §7.8 (months independent), §11 (i18n), §14 (this is the reports feature).
> **ARCH refs:** §5 (layering — RSC reads, no mutations), §8 / ADR-5 (integer cents), ADR-9 (shadcn), ADR-10 (Vitest + Playwright).
> **Charts:** Recharts `^3.10.1` already in `package.json` (month-workspace Stats + templates pies). Do **not** add another chart library.
> **This document is a full user-requirements spec.** A later technical plan may split implementation into the suggested build slices in §16; do not start coding from a thinner interpretation.

---

## 0. Why this exists (job-to-be-done)

The app’s primary job is still **one calendar month at a time** (PRD §1). After years of use, a household also needs a second job:

> **See how the household’s money has evolved across years**, so the family can tell lifestyle creep from inflation, spot categories that are running away, and notice income or savings risks *before* they become next year’s default.

Global Stats does **not** replace the month workspace, the month-workspace **Stats** tab (per-month pies), or **History** (year → month navigation). It is a **read-only observatory** over every month the user has created.

Typical questions this screen must make obvious without a spreadsheet: spend growing faster than income, a savings rate that is slipping, a category that is running away, or an incomplete year that would otherwise look like a fake drop.

---

## 1. Goal

A new principal menu item **Stats** opens a multi-tab analysis workspace at `/[locale]/stats` where the signed-in user can compare **incomes**, **actual expenses** (global and by category), a **household inflation / cost-of-living** reading derived from their own books, and **tendency / risk** insights — from the first created month through the latest created month and every year they add afterwards.

Success looks like: in under a minute the user can answer *“are we spending more because life got more expensive, because we consume more, or because income stalled?”* without exporting to a spreadsheet.

---

## 2. Out of scope (this slice)

Do **not** build:

- Official CPI / INE / Eurostat / any external inflation API or vendor table (PRD scope rule: do not invent vendors). Copy must **never** call the number “CPI”.
- Quantity/price decomposition (tickets have no units — we cannot tell “more milk” from “dearer milk”).
- Category “baskets” or user-defined stat groups (would need schema). Multi-select of existing categories is enough.
- Household sharing (PRD §3). Stats are per signed-in user.
- Mutations, exports, PDF, email reports, budget targets, or forecasts that invent future months (C6: never auto-create a month).
- Changing month-workspace Stats pies, History, or templates charts — reuse patterns, do not merge those screens into this one.
- FX conversion (C9). Amounts stay in the user’s `profile_settings.currency` label.

---

## 3. Actors and jobs

| Actor | Job on this screen |
| --- | --- |
| Allowlisted user | Read long-range charts, switch tabs/filters, drill a category, understand incomplete years. |
| Visitor / blocked Google user | Never see Stats (same auth as every other screen). |
| Coding agent | Implement this spec; do not invent a second money definition that disagrees with PRD §7. |

---

## 4. Information architecture and navigation

### 4.1 New menu item

- Label: `nav.stats` — **en:** “Stats” · **es:** “Estadísticas” (short: it must fit mobile).
- Route: `/[locale]/stats` (default tab `overview`).
- Icon: `BarChart3` (lucide), consistent with existing nav icons.
- Placement: **immediately after Home** — analysis is a first-class job once multi-year data exists.
- Active state: any path starting with `/stats`.

### 4.2 Distinct from existing surfaces

| Surface | Job | Must stay |
| --- | --- | --- |
| Home / month workspace | Capture and steer **this** month | Unchanged |
| Month workspace → Stats tab | Pies for **one** month’s mix | Unchanged |
| History | Browse **past years** and open a month | Unchanged |
| **Global Stats (this UC)** | Compare **across years** | New |

### 4.3 Mobile nav (normative — STYLE-GUIDE amendment at implementation)

STYLE-GUIDE §4 currently caps bottom nav at **5** items. The live app already has **6** (Home, Templates, Annuals, Categories, History, Settings). Adding Stats as a 7th icon is **rejected**.

**At implementation time**, update STYLE-GUIDE §4 to:

| Breakpoint | Items |
| --- | --- |
| **Desktop sidebar (`lg+`)** | Home · **Stats** · History · Annuals · Categories · Templates · Settings (all visible; sidebar can grow) |
| **Mobile bottom nav** | **Home · Stats · History · More · Settings** (exactly 5) |

**More** is a bottom sheet (STYLE-GUIDE §4 forms pattern: `Drawer` on mobile) listing Annuals, Categories, Templates. Settings stays in the bar because it is how users reach language/theme/sign-out on phones that hide the profile chip.

`max-w-4xl` on transactional screens stays. The Stats page is allowed **`max-w-6xl`** (or the full main column) so multi-year charts are readable. Document that exception in STYLE-GUIDE §4 when implementing.

---

## 5. Money definitions (normative)

Integer cents everywhere (ADR-5). Algebraic sums; negatives are first-class (PRD §7.6). **Never** `number`/`float` arithmetic on amounts. Aggregations run in **SQL** (`SUM` / `GROUP BY`); the client must not receive the raw ticket list and reduce it in the browser.

### 5.1 Series

| Series | Source | Use for |
| --- | --- | --- |
| **Income** | `Σ month_income.amount` in the period | Income charts, savings, inflation-of-income |
| **Actual spend** | `Σ month_actual_expense.amount` in the period | Expense charts, household inflation, risks |
| **Reserved remaining** | `Σ month_fixed_line.remaining_amount` | **Caption / projection only** — not mixed into historical spend |
| **Realized savings** (closed month) | `income − actual spend` | Yearly/monthly net, savings rate |
| **Potential savings** (open month) | PRD §7.1 / UC-11: `income − (actuals + remaining)` | KPI footnote for the current calendar month only |

### 5.2 Closed vs open months

Leftover envelopes **die at month end** (C7). Closed months are therefore expected to have **zero** reserved remaining; any remaining belongs to an **open** month that is still being worked.

- Historical expense evolution = **actual spend only**.
- If the latest created month still has remaining > 0, show a persistent sky-tint info note (not amber): *“{monthYear} still has {amount} reserved. Charts use tickets already recorded; they do not treat leftover envelopes as spent.”*
- Optional control on Overview: **“Project remaining as spent”** — adds remaining into **that month only**, drawn as a dashed/hatched segment. Default **off**.

### 5.3 Incomplete years (mandatory)

A year is **complete** when the user has created **12** month instances for it. The current calendar year (and any year the user has not finished creating) will often be incomplete.

**Never** compare a partial year to a 12-month year as if it were a drop in spend (that would show a fake “deflation”).

Default comparison mode when the latest year is incomplete:

- **Like-for-like (LFL):** only months 1…N that exist in **both** years (e.g. year Y months 1–9 vs year Y−1 months 1–9).
- Charts mark incomplete years with a distinct style (dashed stroke or “YTD” badge).
- A toggle **“Show full years only”** hides the incomplete year from YoY % (it still appears on absolute charts with the badge).

A **12-month rolling** series (sum of the last 12 *created* months, ordered by `(year, month)`) is the preferred trend line on Overview and Inflation so the latest point is always a full year of books.

### 5.4 Missing months

Months are never auto-created (C6). If a year has a gap (e.g. no March), that month is **absent**, not zero. Line charts **break the line** (Recharts `connectNulls={false}`). Totals for that year sum only existing months. The UI lists gaps on Overview (*“{year} has {n} months”*) so the user is not gaslit by a quiet hole.

### 5.5 Categories

Use the live `category` name. Soft-deleted categories **still appear** in history (PRD §6.2) with an “Inactive” hint in legends. New tickets cannot use them, but Stats is history.

Do **not** rename, merge, or “fix” category names in code — catalogs are user-owned (including typos).

---

## 6. Screen structure

One page, **URL-driven tabs** so back/share work:

`/[locale]/stats?tab=overview|incomes|expenses|inflation|trends`

Optional query (all additive): `from={year}&to={year}`, `lfl=1`, `category=<uuid>` (repeatable).

**Filters bar** (sticky under the title, all tabs):

- Year from / year to (defaults: min and max year that have at least one month).
- Granularity: **Year** | **Month** (default Year on Overview; Month available everywhere).
- Like-for-like toggle (default on when the `to` year is incomplete).
- Currency label from profile (display only).

Tab strip uses the same tablist pattern as the month workspace (`role="tablist"`). On mobile, tabs scroll horizontally.

Each chart block:

1. Title + one-sentence “how to read it”.
2. Chart (Recharts `ResponsiveContainer`, tokens `--chart-1`…`--chart-5`, `--income`, `--destructive` as already used).
3. Collapsible **data table** (tabular-nums, `formatMoney`) — required for accessibility and for users who distrust charts.
4. Empty state when the filtered range has no months: PRD-style keyed sentence + link to Home to create a month. Stats never creates months.

---

## 7. Tab: Overview

**Job:** the household’s “annual report cover”.

### 7.1 KPI row (integer cents → `formatMoney`)

For the selected range, show four cards:

| KPI | Formula | Caption |
| --- | --- | --- |
| Income | Σ incomes | vs previous like-for-like period, % and € |
| Actual spend | Σ actuals | same |
| Realized savings | income − actuals | savings rate = savings / income (hide % if income = 0) |
| Savings rate Δ | this rate − previous LFL rate | amber if dropped ≥ 5 percentage points (see §11) |

Use the brand gradient **only** on the savings card when savings ≥ 0 (STYLE-GUIDE §5). Negative savings → solid `--destructive` card, same as the month hero.

### 7.2 Required charts

1. **Income vs actual spend over time** — `ComposedChart`: bars = yearly (or monthly) spend, line = income. Dual series, one y-axis (same currency).
2. **12-month rolling spend and income** — two `LineChart` series. The last point is always a full year of data when ≥ 12 months exist.
3. **Savings rate by year** — `BarChart`, percent axis, 0% reference line.
4. **Year composition (latest complete year)** — donut of actuals by expense category (reuse month-stats pie recipe). Beside it, the same donut for the first complete year in range, so mix shift is visible.

### 7.3 Snapshot copy (computed, keyed)

One short paragraph under the KPIs, e.g. en: *“From {from} to {to}, spend went from {spendFrom} to {spendTo} ({spendPct}). Income went from {incFrom} to {incTo} ({incPct}). Savings rate went from {rateFrom} to {rateTo}.”* Spanish equivalent. This is the “so what” a family reads first.

---

## 8. Tab: Incomes

**Job:** how money **in** evolved — monthly, yearly, and by income category.

### 8.1 Required charts

1. **Yearly income** — `BarChart`, one bar per year.
2. **Monthly income** — `LineChart` over `(year, month)` in range (nulls for missing months).
3. **Income by category over years** — stacked `BarChart` or stacked `AreaChart` (categories = `category.kind = income`). Legend toggle (Recharts) to hide a series.
4. **Category mix** — donut for a selected year (default: latest complete year) + small table of share %.
5. **Largest-category dependence** — line: largest income category as % of that year’s income. Caption explains concentration risk (one source dominating, or a former source going to zero).

### 8.2 Table

Year × income-category matrix: amounts + YoY % per cell (LFL when needed). Inactive categories included.

---

## 9. Tab: Expenses

**Job:** how money **out** evolved — globally and **by category**, monthly and yearly.

### 9.1 Required charts

1. **Yearly actual spend** — `BarChart`.
2. **Monthly actual spend** — `LineChart` + optional 12-month rolling overlay.
3. **By category over years** — stacked `BarChart`/`AreaChart` of expense categories. Default: top **8** by total in range + an **Other** bucket (sum of the rest). Control: “Show all categories”.
4. **Category ranking** — horizontal `BarChart` of totals in range; click a bar → sets `category` filter and scrolls to the drill-down.
5. **Drill-down (when one or more categories selected)** — monthly line of those categories vs the unselected rest (context). Yearly small-multiples (one mini sparkline per selected category) are acceptable on `md+`.
6. **Seasonality** — for a selected complete year (or average of complete years): 12 bars (Jan–Dec, locale month names). Makes seasonal peaks visible without a lecture.

### 9.2 Table

Year × expense-category matrix: amount, share of that year’s spend, YoY %. Same LFL rules.

---

## 10. Tab: Inflation (household cost change)

**Job:** quantify *how much more (or less) this household’s recorded life costs*, and what that did to **real income** and **savings**. Honest about limits: this is **not** a price index.

### 10.1 Methodology (normative)

Tickets have **no quantities**. The app therefore measures **cost change of recorded spend**, not CPI.

Let `S(y)` = actual spend in year `y` (LFL months when either year is incomplete).  
Let `I(y)` = income in the same months.

| Metric | Formula | Meaning |
| --- | --- | --- |
| **Household cost change (HCC)** | `(S(y) / S(y−1) − 1)` | Headline “inflation-like” % for this home |
| **Category cost change** | same, per expense category | Which lines of life got dearer |
| **Contribution to ΔS** | `S(y, c) − S(y−1, c)` | Euros of the yearly increase that category explains |
| **Income change** | `(I(y) / I(y−1) − 1)` | Did pay keep up? |
| **Real-income index** | `I(y) / S(y) × S(base)` expressed as an index **or** simply `I(y)/S(y)` vs `I(base)/S(base)` | Purchasing-power proxy: income relative to this household’s own basket |
| **12-month rolling HCC** | YoY of the rolling spend series | Avoids incomplete-year artefacts |

**Base year:** first **complete** year in the selected range. User cannot pick an official CPI base; they *can* change `from`/`to`.

**Copy (mandatory disclaimer, both locales):** this number is *“change in what you recorded as spend, not the official consumer-price index. More consumption and higher prices both raise it.”*

### 10.2 Required charts

1. **HCC by year** — bar of % (hide the incomplete year from this % chart unless LFL is on — and when LFL is on, label *“Jan–{N} vs Jan–{N}”*).
2. **Income change vs HCC** — grouped bars or two lines. The household is “ahead” when income % > HCC.
3. **Category contributions to last ΔS** — waterfall if straightforward in Recharts; otherwise a signed horizontal bar (positives = grew, negatives = shrank). Top 10 + Other.
4. **Constant-basket illustration (optional but recommended):** for each category, `S(y, c)` vs `S(base, c)` as an index 100 at base. Small-multiples for the top 6 categories. This is still not CPI; it is “how this line of spend moved”.
5. **Cumulative extra cost:** `Σ_{y > base} (S(y) − S(base))` as a running total — “euros above the base year”, a visceral household number. Caption must say it mixes volume and price.

### 10.3 What “impact” means on this tab

Show three sentences (templated):

- If HCC > income change: *“Your cost of recorded life rose faster than income. Savings rate is the pressure valve.”*
- If income change > HCC: *“Income outpaced your recorded spend growth. Check whether the mix shifted into housing or dependents.”*
- Largest expense category as % of income, base year vs latest — families often feel housing or the top line first.

Do not moralize (“you overspent”). Facts + the savings-rate card.

---

## 11. Tab: Trends & risks

**Job:** surface **tendencies** and **risks** a household economist would flag. Warn only, never block (PRD §7.4 philosophy). Amber for watch, sky-tint for informational. **Never red** except a true deficit (spend > income) icon+text pair.

### 11.1 Detector list (all computed in the service; all unit-testable)

Each detector returns `{ id, severity: "info" | "watch" | "risk", categoryId?: uuid, metrics }`. The UI maps `id` to i18n copy with placeholders. If a detector does not fire, it is omitted (no “all green” spam beyond a single empty-state sentence).

| ID | Fires when | Why it matters |
| --- | --- | --- |
| `savingsRateDrop` | Savings rate down ≥ **5 pp** vs previous complete (or LFL) year | Lifestyle creep |
| `spendOutpacingIncome` | HCC > income change by ≥ **3 pp** in the latest comparable pair | Purchasing power squeeze |
| `categoryRunaway` | A category’s LFL YoY ≥ **15%** **and** faster than income change | Line-item risk |
| `categorySpike` | A category’s LFL YoY ≥ **25%** | Same, higher severity |
| `newCategoryMaterial` | Category with 0 spend in previous complete year and ≥ **5%** of latest year’s spend | New structural cost |
| `housingBurden` | Largest expense category ≥ **30%** of income | One line crowding out savings. Do **not** hardcode a category name; use “largest expense category” unless we later add tags (schema — out of scope) |
| `incomeConcentration` | Largest income category ≥ **85%** of income | Job/salary shock risk |
| `incomeSourceGone` | An income category that was ≥ **10%** of income two years ago and is **0** in the latest complete year | Lost side income |
| `deficitMonth` | Any month in range with actuals > income | Cash-flow stress; list year-month |
| `deficitYear` | A complete year with realized savings < 0 | Structural overspend |
| `seasonalityPeak` | In complete years, the peak month’s spend ≥ **1.4×** that year’s monthly average | Predictable crunch (holidays, school, insurance month, …) |
| `openMonthReserve` | Latest month remaining > 0 | Informational: year-to-date is not finished |
| `sparseYear` | A year in range with fewer than 12 months **and** not the current calendar year | Data-quality gap, not economics |
| `threeYearCagr` | For top 5 categories, 3-year CAGR of actuals (complete years only) shown as a table even if below thresholds | Tendency, not only alerts |

**CAGR** (complete years `y0`…`y1`, n = y1−y0):  
`(S(y1,c) / S(y0,c))^(1/n) − 1` with integer-cents → rational math that does **not** use `Math.pow` on euro floats. Convert to a decimal rate via integer cents as the ratio of two ints, then use a tested helper. Document the helper in ARCH §8 when implementing. If `S(y0,c) = 0`, skip CAGR and use `newCategoryMaterial` instead.

### 11.2 Required charts on this tab

1. **Alert list** (cards), newest/highest severity first.
2. **Sparkline strip** — top 6 expense categories, 12-month rolling, color from chart tokens.
3. **Savings rate + HCC overlay** (two lines, dual units: % savings rate and % HCC) — the “are we absorbing inflation?” picture.
4. **Deficit months** — calendar heatmap or simple year/month table with negative `formatMoney`. Heatmap is optional; the table is required.

---

## 12. Filters, empty states, and future years

- Range always ⊆ years that **exist** for this user. Creating 2027 months later **automatically** extends Stats; no extra work.
- Zero months: empty state, no charts, CTA to Home (create month). Same for a filter that matches nothing.
- One month only: still show Overview KPIs; hide YoY and HCC (need two periods); Trends may still fire `openMonthReserve`.
- Locale: month names via existing `monthName` / `monthYear` helpers (PRD §11). Amounts always `formatMoney` (dot-decimal, 2 places, currency label).

---

## 13. Technical constraints (for the later plan)

These are **requirements**, not an implementation.

| Topic | Rule |
| --- | --- |
| Schema | None. No CPI table. |
| Layering | RSC loads aggregated DTOs. **No server actions** unless a cookie for last tab is added (not required; URL is enough). Service owns all formulas. Repository owns SQL. `userId` first on every repo call (P0). |
| Aggregation | Postgres `SUM` grouped by `month.user_id`, `year`, `month`, `category_id`. Do not load raw tickets into the service. Revisit indexes only if a query is slow. |
| Money | `parseAmount` → cents → `sumCents` / integer algebra → `formatMoney` for display. Chart `dataKey` values are **cents as integers** or pre-rounded display numbers produced from cents — never JS `0.1+0.2` sums. |
| Library | Recharts only: `LineChart`, `BarChart`, `AreaChart`, `ComposedChart`, `PieChart`, `Brush` (optional on long monthly series), `Tooltip`, `Legend`, `ResponsiveContainer`. Tooltips use `formatMoney` / percent with 1 decimal. |
| Theme | Chart strokes/fills from CSS variables already defined (`--chart-*`, light + dark). Same tooltip chrome as `stats-screen.tsx`. |
| Tenancy | User B’s Stats is empty/isolated even if User A has many months (PRD §15 #2 pattern). |
| PWA | Online-only (C11). Do not cache Stats payloads in the service worker. |
| Layout | Client charts inside server page; keep the filters as a client island. Prefer one client `GlobalStatsScreen` fed by serializable cents DTOs (same pattern as month `StatsScreen`). |

Suggested service boundary (names may change in the tech plan, the contract may not):

- `getGlobalStatsOverview(userId, range)`
- `getIncomeSeries(userId, range)`
- `getExpenseSeries(userId, range)`
- `getHouseholdInflation(userId, range)`
- `getTrendSignals(userId, range)`

One repository module `src/server/repositories/global-stats.ts` is acceptable so SQL stays in one place. Do **not** scan all tickets in the service.

---

## 14. i18n keys (namespaces)

All strings keyed in `en` + `es` (parity test). Suggested tree:

- `nav.stats`
- `nav.more` (mobile overflow)
- `stats.title`, `stats.tabs.*`, `stats.filters.*`, `stats.kpis.*`, `stats.charts.*` (title + help per chart)
- `stats.inflation.disclaimer`
- `stats.inflation.impact.*` (the three sentence templates)
- `stats.signals.*` (one key per detector id)
- `stats.empty.*`, `stats.openMonthNote`, `stats.incompleteYear`, `stats.ytd`, `stats.lfl`
- `stats.a11y.tableToggle`

No hardcoded month names, no hardcoded category names in copy.

---

## 15. Acceptance criteria / tests

There is no PRD §15 scenario for reports. These are **this file’s** normative tests.

### 15.1 Unit (formulas)

1. Realized savings = income − actuals; potential savings still matches UC-11 when remaining ≠ 0.
2. HCC for two complete years: fixture spend `800.00` vs prior `640.00` → 25.00% (cents in, percent out with a defined rounding — 1 decimal, half-up).
3. LFL: year A months 1–12 vs year B months 1–9 → compare only 1–9.
4. Incomplete year **must not** produce a negative HCC solely because of missing months when LFL is off — the % series **omits** that year unless LFL is on.
5. Missing March is `null`, not `0`.
6. Contribution: categories summing to `S(y)−S(y−1)` (integer cents, other-bucket holds remainder).
7. Each detector in §11.1: fire / not-fire fixtures (including the 5 pp savings drop and 15%/25% category thresholds).
8. CAGR skipped when base spend is 0.
9. Soft-deleted category still aggregated by id/name.

### 15.2 Integration

10. Every global-stats query includes `month.user_id = userId` (or equivalent join). User B cannot read user A’s series (amounts, categories, years).
11. SQL aggregates: a fixture of 3 months / 2 categories returns the same cents as a hand-sum; deleting an actual (hard delete) drops it from Stats.
12. Open month remaining is **excluded** from actual-spend series and **included** only in the projection flag path.

### 15.3 E2E (Playwright, chromium + mobile-safari)

13. Sign-in → bottom/sidebar **Stats** → Overview KPIs render for a user with seeded fixture months spanning at least two complete years.
14. Tabs Incomes / Expenses / Inflation / Trends are reachable via `?tab=` and the tablist (keyboard).
15. Incomplete latest year shows a YTD/LFL badge; YoY on Inflation uses LFL by default.
16. Spanish locale: title “Estadísticas”, month names in Spanish, amounts still dot-decimal.
17. Empty user (no months): empty state, no chart crash.
18. Mobile: 5 bottom items including Stats and More; Annuals reachable from More.

### 15.4 Visual / a11y

19. Every chart has a data-table toggle. Contrast: tooltip/legend readable in light and dark (STYLE-GUIDE §6).
20. Typecheck + lint clean; i18n parity.

---

## 16. Suggested later implementation slices

This UC stays **one** requirements file. A technical plan may cut delivery as follows (optional):

| Slice | Ships |
| --- | --- |
| UC-15.1 | Nav (incl. mobile More) + route shell + Overview KPIs + income-vs-spend chart + empty states |
| UC-15.2 | Incomes tab (yearly, monthly, by category) |
| UC-15.3 | Expenses tab (global, by category, seasonality, drill-down) |
| UC-15.4 | Inflation tab (HCC, contributions, real-income proxy, disclaimer) |
| UC-15.5 | Trends tab (detectors + sparklines) |

Do not mark UC-15 `DONE` until 15.1–15.5 (or an equivalent full delivery) meet §15. Partial shipping is allowed only if `IMPLEMENTATION-STATUS.md` notes which tabs are live.

---

## 17. Open decisions (defaults apply unless the Product Owner overrides)

| # | Topic | Default in this spec |
| --- | --- | --- |
| D1 | Mobile “More” vs grouping catalogs under one “Catalogs” hub | **More sheet** (less new IA) |
| D2 | Official CPI overlay | **Out of scope** |
| D3 | User-defined category groups | **Out of scope** (multi-select only) |
| D4 | Persist filters in a cookie | **No** — URL query only |
| D5 | Project remaining as spent | **Off** by default, Overview-only toggle |
| D6 | Waterfall vs signed bars for inflation contribution | Signed bars if waterfall is awkward in Recharts |

---

## Depends on

- **UC-01** (auth / tenancy), **UC-02** (i18n), **UC-03** (categories, including inactive history), **UC-04** (currency label), **UC-06** (months exist), **UC-07** (incomes), **UC-08** (actuals), **UC-11** (savings algebra to stay consistent).
- **UC-14 is DONE.** Annuals is in the nav and will move into **More** when this slice reshuffles mobile chrome.
- Does **not** depend on templates remaining, pass-to-actual, or annuals data (annuals are reminders, not a spend series).
