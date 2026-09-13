# UC-19 — Excel export of month expenses

> **PRD status:** Merged at high level into `docs/prds/GLOBAL.md` as **UC-24** / C22. This file is the detailed implementation slice.
> **No schema change.** Reuse `month`, `month_income`, `month_actual_expense`, `month_fixed_line`, `category`, and `profile_settings`. Do not add tables or columns.
> **PRD refs:** C1 / C4 / C6 / C9 / C11 / C12 / C22, §5.1 (tenancy), §7.1 (savings algebra), §11 (i18n).
> **ARCH refs:** §5 (thin action → service → repository SQL), §8 / ADR-5, ADR-6, ADR-9, ADR-10, **ADR-11 (ExcelJS)**.
> **Visual:** `docs/styles/STYLE-GUIDE.md` wins for tokens. §7 of this file is the Home picker layout (mobile-first). Do not invent a second palette. Excel fill colors are the same brand hex values written as ARGB.

---

## 0. Why this exists (job-to-be-done)

The app’s primary job is still **one calendar month at a time**. After years of months, a second job appears:

> **Take the months I already created and download them as an Excel workbook I can archive, share, or open in a spreadsheet.**

Export does **not** replace History (browse), Global Stats (aggregates), or Search (find a ticket). It is a **read-only dump** of month-scoped money rows the signed-in user owns.

Typical question: *“give me September and August as a spreadsheet, with the same totals I see in the app.”*

---

## 1. Goal

On **Home**, an **Export** button opens a picker. The user chooses a scope (**All**, **Select by year**, or **Select specific months**) and downloads one `.xlsx` file.

Success looks like: on a 360px phone, tap Export → pick “Select specific months” → check September 2026 and August 2026 (newest at the top) → Download Excel → the browser saves a workbook with two sheets, each structured like the month workspace (Incomes, Actuals, Committed, Estimated, plus the same totals).

---

## 2. Out of scope (this slice)

Do **not** build:

- CSV, PDF, Google Sheets, email, or cloud backup.
- Charts, sparklines, pivot tables, or macros in the workbook.
- Export of catalogs (`category`, `template`, `annual`) or `app_user` / settings rows. The file is **month workspaces**, not a database dump of every table.
- Creating a month in order to export it (C6).
- A new nav destination. Export lives on Home only.
- Scheduling, recents, or saving the last scope.
- Editing data from the spreadsheet back into the app (import).

---

## 3. Actors and jobs

| Actor | Job on this control |
| --- | --- |
| Allowlisted user | Pick a scope and download their own months as Excel. |
| Visitor / blocked Google user | Never see Home, never hit the action. |
| Coding agent | Tenant-scope every read. Never auto-create a month. Integer cents until the Excel write boundary. |

---

## 4. Domain contract (normative)

### 4.1 Trigger (UI)

**Export** lives on Home (`/[locale]`), in the page header next to the title, on both the empty-state and the month-list state.

It is visible even when the current calendar year has no months, because older years may still exist (Home’s list currently filters to the current year). The picker is filled from **every** `month` row the user owns, not only the current year.

### 4.2 Scope modes

Exactly one mode is selected:

| Mode | Wire `mode` | What is exported |
| --- | --- | --- |
| **All** | `all` | Every `month` row this user owns. |
| **Select by year** | `year` | Every owned month whose `year` is in the **checked** years (one or more). |
| **Select specific months** | `months` | The checked `(year, month)` periods that this user actually owns. |

Rules:

1. Year options are the **distinct years** present in this user’s `month` rows, sorted **descending** (2026 above 2025). Years with no month are absent — the user cannot invent a year. **Multiple years can be checked.**
2. Month options are every owned `(year, month)`, labelled with the locale month name + year, sorted **descending** (newest first). Months that were never created are absent — the user cannot invent October (C6).
3. Duplicate periods in `months` are ignored. Request order does not matter; the workbook is always newest-first.
4. Periods that do not exist for this tenant are skipped (no leak, no auto-create). If the resolved set is empty, `NothingToExportError`.
5. Cap: at most **240** periods in one file (20 years of months). Zod rejects a longer `months` list.

### 4.3 Workbook shape

- Format: Office Open XML `.xlsx` (ADR-11, ExcelJS).
- **One worksheet per exported month.** No cover sheet. No charts.
- Sheet order: `year DESC`, `month DESC`.
- Sheet name: `{YYYY}-{MM} {locale month name}` (example `2026-09 September`), truncated/sanitized to Excel’s 31-character rule and forbidden characters `\ / ? * [ ]`. The `{YYYY}-{MM}` prefix keeps names unique after truncation.
- Filename:
  - `all` → `monthly-expenses-all.xlsx`
  - `year` with one year → `monthly-expenses-{year}.xlsx`
  - `year` with several years → `monthly-expenses-selected.xlsx`
  - `months` with one period → `monthly-expenses-{year}-{MM}.xlsx`
  - `months` with several periods → `monthly-expenses-selected.xlsx`

### 4.4 Each sheet (layout)

Title block:

1. App name (i18n) + locale month-year (e.g. `Monthly Expenses — September 2026`).
2. Currency label from `profile_settings` (default `EUR` if the row is missing).

Then four **data sections** in this order, matching the workspace vocabulary:

1. **Incomes** — category, name, amount. Total row = `Σ amount` (integer cents).
2. **Actuals** — category, name, notes (`observations`, blank when null), amount. Total row = `Σ amount`.
3. **Committed** — category, name, notes, origin (`cloned` / `month_only` keyed labels), remaining, original. Total row = `Σ remaining`.
4. **Estimated** — same columns as Committed. Total row = `Σ remaining`.

Empty sections still render the header and a total of `0.00`.

Then a **Summary** block using the same algebra as UC-11 / PRD §7.1:

| Row | Value |
| --- | --- |
| Income | `Σ incomes` |
| Actuals | `Σ actuals` |
| Reserved | `Σ remaining` of committed **and** estimated |
| Total expenses | Actuals + Reserved |
| Potential savings | Income − Total expenses |

Totals are **precomputed in integer cents** in the service, then written once at the Excel boundary. Do **not** use Excel `=SUM()` formulas for these totals (ADR-5: the app’s number is the source of truth).

Row order inside a section:

- Incomes / actuals: `created_at` ascending (same as the workspace lists).
- Committed / estimated: `cloned` before `month_only`, then name (`localeCompare`), matching the workspace `orderRows` helper.

Inactive categories still **label** historical rows (PRD §6.2). No extra “inactive” column in this slice.

### 4.5 Money in Excel

Domain code stays integer cents. The workbook builder converts with `Number(formatCents(cents))` **once per cell** and applies Excel number format `#,##0.00` (dot decimal, comma thousands — same display convention as `formatMoney`, without the currency suffix; the currency lives in the title block). Never `number`/`float` arithmetic on amounts in the service.

### 4.6 Tenancy (P0)

Every repository function takes `userId` first. Child-row reads **join** `month` and filter `month.user_id = userId` **and** `month.id IN (...)`. User B never receives User A’s months, including via a crafted year or period list.

Export never inserts a `month` row.

### 4.7 Online-only (C11)

The file is generated on the server at click time. Do not cache workbooks in the service worker.

---

## 5. Layering

| Layer | Responsibility |
| --- | --- |
| Home RSC `src/app/[locale]/page.tsx` | Load `getMonthList(userId)`. Pass distinct years + month options (labels via `monthYear`) into the export client. Do not generate the file here. |
| Client `src/components/export-expenses-drawer.tsx` | Picker. Confirm calls the action. On success, decode base64 and trigger a browser download. |
| Action `src/actions/export.ts` | Zod discriminated union → `requireUserId()` → load i18n copy + locale → service → `{ ok, filename, base64 }`. **No revalidate** (read). |
| Service `src/server/services/export.ts` | Resolve months for the scope; load money rows; build per-month DTOs + summary cents; call the workbook builder. |
| Repository `src/server/repositories/export.ts` | Bulk tenant-scoped reads for incomes / actuals / reserved lines (SQL only). Reuse `listMonths` / `listMonthsByYear` / new `listMonthsByPeriods`. |
| Workbook `src/server/export/build-workbook.ts` | ExcelJS only. No SQL. `import "server-only"`. |
| Helpers `src/lib/export-selection.ts` | Sort descending, unique years, filename, sheet-name sanitize. No I/O. |

Suggested DTOs (names may change; the fields may not):

```ts
type ExportSelection =
  | { mode: "all" }
  | { mode: "year"; years: number[] }
  | { mode: "months"; periods: { year: number; month: number }[] };

type ExportActionResult =
  | { ok: true; filename: string; base64: string }
  | { ok: false; error: "nothingToExport" | "validation" };
```

The action is a **read that returns a file payload**. A Server Action is used (ADR-6, CSRF) because RSC cannot set `Content-Disposition`. The payload is base64 of the `.xlsx` bytes. This is not a mutation and must not `revalidatePath`.

---

## 6. Routes / URL

No new page route. Lives on `/[locale]` (Home). The download is a client-side blob from the action result, not `/api/export`.

---

## 7. Screen — first-mobile UI (normative)

**Subject:** household monthly ledger. **Audience:** the same person who already uses Home. **Single job:** choose which created months go into the spreadsheet.

STYLE-GUIDE tokens only. No cream/serif, no acid-green-on-black, no broadsheet hairlines. No brand gradient on this control (the savings hero on the month workspace keeps that privilege).

### 7.1 Design tokens (from STYLE-GUIDE §1 / §3)

| Role | Token | Hex |
| --- | --- | --- |
| Sheet surface | `--card` white | `#FFFFFF` |
| Selected mode / year / month fill | `sky-tint` / `--secondary` | `#E8F4FD` |
| Selected left rail | `--primary` navy | `#1B3A6B` |
| Download | `--primary` navy | `#1B3A6B` |
| Body / labels | `ink` / `--foreground` | `#0F1E33` |
| Helper text | `slate` / `--muted-foreground` | `#5B6B7F` |
| Focus ring | `--ring` blue | `#2E7DB2` |

Dark mode uses the existing token mapping. Do not add picker-only hex values.

**Type:** same face as Home (`text-sm` options, `text-base` title). No display size on year/month names.

**Signature (the one memorable thing):** a **reverse-chronology ledger picker** — All / year / months as three choice cards, then a descending list of only years or months that already exist. Not a date widget, not a native `<select>`, not a 12-month calendar grid with empty cells.

**Critique vs a generic export dialog:** a default dialog would offer “from / to” dates or a file-type dropdown. This picker only offers **scopes this user can actually fill**, newest first, matching how Home already lists months.

### 7.2 Mobile layout (360px base)

```
Home header
┌─────────────────────────────────┐
│ Home                    [Export]│  44px target, outline button + icon
└─────────────────────────────────┘

Bottom sheet
┌─────────────────────────────────┐
│ ──                              │  grab
│ Export expenses                 │
│ Download an Excel file with one │
│ sheet per month.                │
│                                 │
│ ● All                           │  sky-tint + navy rail
│   Every month you have created. │
│ ○ Select by year                │
│ ○ Select specific months        │
│                                 │
│ (year or month list when needed)│  newest first, scroll
│                                 │
│ [ Cancel ]    [ Download Excel ]│  44px
└─────────────────────────────────┘
```

- Reuse the existing `Drawer` (bottom sheet). `max-w-lg` already matches desktop. Content scrolls inside `max-h-[85dvh]`.
- Mode options, year options, and month options are full-width buttons, min height **44px**.
- Years: `role="group"` of checkboxes. None pre-checked. Download stays disabled until at least one year is checked.
- Months: `role="group"` of checkboxes. None pre-checked. Download stays disabled until at least one is checked.
- **No** amount, category, or “does not exist” placeholder rows.
- When the user owns **zero** months: the three modes remain, the lists are empty, Download is disabled, and keyed empty copy explains they must create a month first.

### 7.3 Interaction

| Input | Result |
| --- | --- |
| Tap Export | Open sheet; mode **All** preselected. |
| Tap All | Hide year/month lists. Download enabled iff the user has at least one month. |
| Tap Select by year | Show year checkboxes (desc). Download disabled until ≥1 checked. |
| Tap Select specific months | Show month checkboxes (desc). Download disabled until ≥1 checked. |
| Download Excel | Run the action; on success, close and start the browser download; on failure, stay open with keyed error. |
| Cancel / backdrop / Escape | Close; no file. |

Pending: disable Download, keep the button label as the loading copy (`common.loading`).

### 7.4 Copy (keyed, both locales)

| Key | en | es |
| --- | --- | --- |
| `export.button` | Export | Exportar |
| `export.title` | Export expenses | Exportar gastos |
| `export.body` | Download an Excel file with one sheet per month. | Descarga un archivo Excel con una hoja por mes. |
| `export.mode.all` | All | Todos |
| `export.mode.allHelp` | Every month you have created. | Todos los meses que hayas creado. |
| `export.mode.year` | Select by year | Elegir por año |
| `export.mode.yearHelp` | Pick one or more years that already have a month. | Elige uno o más años que ya tengan un mes. |
| `export.mode.months` | Select specific months | Elegir meses concretos |
| `export.mode.monthsHelp` | Pick any months you have created. | Elige meses que ya hayas creado. |
| `export.yearList` | Years | Años |
| `export.monthList` | Months | Meses |
| `export.download` | Download Excel | Descargar Excel |
| `export.empty` | Create a month first. Nothing is exported until a month exists. | Crea un mes primero. No hay nada que exportar hasta que exista un mes. |
| `export.needYear` | Pick at least one year. | Elige al menos un año. |
| `export.needMonth` | Pick at least one month. | Elige al menos un mes. |
| `validation.nothingToExport` | Nothing to export for that selection. | No hay nada que exportar para esa selección. |

Reuse `common.cancel` and `common.loading`. Month names come from `monthName` / `monthYear` (PRD §11), never hardcoded.

Workbook labels (passed into the builder, also keyed):

| Key | en | es |
| --- | --- | --- |
| `export.sheet.incomes` | Incomes | Ingresos |
| `export.sheet.actuals` | Actuals | Gastos reales |
| `export.sheet.committed` | Committed | Comprometidos |
| `export.sheet.estimated` | Estimated | Estimados |
| `export.sheet.summary` | Summary | Resumen |
| `export.sheet.category` | Category | Categoría |
| `export.sheet.name` | Name | Nombre |
| `export.sheet.notes` | Notes | Notas |
| `export.sheet.amount` | Amount | Importe |
| `export.sheet.remaining` | Remaining | Pendiente |
| `export.sheet.original` | Original | Original |
| `export.sheet.origin` | Origin | Origen |
| `export.sheet.total` | Total | Total |
| `export.sheet.currency` | Currency | Moneda |
| `export.sheet.originCloned` | Cloned | Copiada |
| `export.sheet.originMonthOnly` | One-off | Puntual |

Reuse `months.summary.*` for Income / Actuals / Reserved / Total expenses / Potential savings in the Summary block.

### 7.5 Motion and a11y

- Sheet: `role="dialog"`, labelled by the title, described by the body.
- Visible `focus-visible` ring (`--ring`).
- Selected state is navy rail **and** sky-tint, not color alone.
- `prefers-reduced-motion: reduce` → rely on the Drawer’s existing reduced motion. Do not add per-row stagger.
- Touch targets ≥ 44px on Export, mode cards, year/month rows, Cancel, and Download.
- The Export button’s accessible name is `export.button`.

### 7.6 Desktop (`lg+`)

Same bottom sheet (`max-w-lg`). Do not switch to a floating `<select>` or a date range.

### 7.7 Excel visual (workbook, not the web UI)

Use STYLE-GUIDE hex as ARGB fills. One accent language, no charts.

| Region | Fill | Font |
| --- | --- | --- |
| Title row | navy `#1B3A6B` | white, bold |
| Incomes section header | green-deep `#4C7A1F` | white, bold (not white-on-`green`) |
| Actuals section header | blue `#2E7DB2` | white, bold |
| Committed section header | navy `#1B3A6B` | white, bold |
| Estimated section header | teal `#2AA198` at header size with white — short bold label, same exception as the estimated badge | white, bold |
| Total rows | offwhite `#F6F8FB` | ink, bold, top border |
| Summary header | navy `#1B3A6B` | white, bold |
| Potential savings row | green-tint `#EFF7E3` | green-deep, bold |

Freeze the title row. Landscape print, fit to width 1. Column widths sized for category/name/notes. No gridlines extra styling beyond header fills.

---

## 8. i18n keys (namespaces)

All strings keyed in `en` + `es` (parity test). Keys listed in §7.4. Month names are not keyed — they come from `Intl`.

---

## 9. Acceptance criteria / tests

Mapped PRD §15 scenarios: **#32, #33, #34**. Plus the slice tests below.

### 9.1 Unit (`src/lib/export-selection.ts` + workbook builder)

1. `sortPeriodsDescending` orders `(2025,12)` after `(2026,8)` after `(2026,9)`.
2. `uniqueYearsDescending` from mixed months → `[2026, 2025]`.
3. `exportFilename` matches §4.3.
4. `sanitizeSheetName` strips `[]?*\/` and caps at 31 characters while keeping the `YYYY-MM` prefix.
5. Workbook: two months → two sheets, newest first; Incomes/Actuals/Committed/Estimated/Summary present; total cells equal the integer-cents summary (parse back via ExcelJS). Empty section still has a `0` total. No chart objects.

### 9.2 Integration (real Postgres)

6. **#32 All:** Alice has Aug 2026 (income 2000, actual 50, committed remaining 800, estimated remaining 400) and Sep 2026 (empty). Export `all` → 2 sheets, Sep then Aug. Aug summary savings `750.00` (PRD §7.1). Bob’s October is absent.
7. **#33 Year:** Alice has 2026-08 and 2025-12. Export `{ mode: "year", years: [2026] }` → one sheet `2026-08`. Export `{ mode: "year", years: [2026, 2025] }` → two sheets, 2026-08 then 2025-12. Year `[2024]` (no rows) → `NothingToExportError`. Year list helper returns `[2026, 2025]`.
8. **#34 Months:** Export `{ mode: "months", periods: [{2025,12},{2026,8}] }` → two sheets, 2026-08 then 2025-12. A period Bob owns is skipped when Alice requests it. Crafted missing period does not create a month (C6).
9. Cross-tenant: Alice calling with Bob’s year still only returns Alice’s months. Repository queries include `month.user_id`.
10. Inactive category still labels an historical actual on the sheet (PRD §6.2).
11. Negative actual is first-class in the Actuals total and savings (PRD §7.6).

### 9.3 E2E (Playwright, chromium + mobile-safari)

12. Home shows Export. Opening the dialog defaults to All. Download saves `monthly-expenses-all.xlsx` with one sheet per seeded month.
13. Select by year: years listed newest-first as checkboxes; only years with data; Download disabled until a year is checked; two years → `monthly-expenses-selected.xlsx` with both years’ months.
14. Select specific months: months listed newest-first; Download disabled until a month is checked; file contains only those sheets.
15. User with zero months: Download disabled; empty copy visible.
16. Spanish: button “Exportar”, title “Exportar gastos”, download “Descargar Excel”.

### 9.4 Visual / a11y / quality

17. Options are ≥ 44px. Focus ring visible. Sheet is labelled.
18. Typecheck + lint clean; i18n parity; no `userId`-less repository call; `exceljs` imported only from server modules.

---

## 10. Suggested files (implementation time)

| Path | Role |
| --- | --- |
| `src/lib/export-selection.ts` | Sort, filename, sheet-name sanitize |
| `src/server/export/build-workbook.ts` | ExcelJS workbook |
| `src/server/export/copy.ts` | Label DTO type |
| `src/server/repositories/export.ts` | Bulk tenant-scoped money reads |
| `src/server/repositories/month.ts` | `listMonthsByPeriods` |
| `src/server/services/export.ts` | Scope resolve + DTO + summary |
| `src/actions/export.ts` | Zod action, base64 payload |
| `src/components/export-expenses-drawer.tsx` | Home picker |
| `src/app/[locale]/page.tsx` | Export button + options |
| `src/i18n/messages/{en,es}.json` | Keys in §8 |
| `tests/unit/export-selection.test.ts` | §9.1 helpers |
| `tests/unit/export-workbook.test.ts` | §9.1 workbook |
| `tests/integration/export.test.ts` | §9.2 |
| `tests/e2e/export.spec.ts` | §9.3 |

---

## 11. Open decisions (defaults apply unless the Product Owner overrides)

| # | Topic | Default in this spec |
| --- | --- | --- |
| D1 | Import from Excel | **Off** |
| D2 | Charts in the workbook | **Off** |
| D3 | Catalog tables in the file | **Off** (months only) |
| D4 | Default mode when opening the picker | **All** |
| D5 | Download transport | Server Action + base64 blob (not a Route Handler) |
| D6 | Excel totals | Precomputed cents, not `=SUM()` |

---

## Depends on

- **UC-01** (auth / tenancy), **UC-02** (i18n), **UC-04** (currency label), **UC-06** (months exist, never auto-created), **UC-07** (incomes), **UC-08** (actuals), **UC-09** (committed + estimated lines), **UC-11** (summary algebra).
- Does **not** depend on UC-12 PWA chrome, UC-14 annuals, UC-15 charts, UC-16 Search, UC-17 autocomplete, or UC-18 pass-to-upcoming.
- **No schema change.**
