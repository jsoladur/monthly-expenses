# UC-20 — Fixed expense hard delete & month schedule

> **Database:** **adds one column** — `template.months smallint[]` (nullable) + check constraint `template_months_ck`, via migration 0005. Product Owner decision 2026-11-03.
> **PRD refs:** **UC-25** / **C23**; §6.3; §7.4; §7.8; §8; §13. Screen 7 (PRD §10).
> **ARCH refs:** §4 (data model), §5 (layering), §8 rule 4 (overspend baseline).

## Goal

Two changes to the Fixed expenses catalog (`/[locale]/templates`, UC-05):

1. **Delete** — the user can permanently remove a fixed expense, not only deactivate it.
2. **Month schedule** — the user can limit a fixed expense to specific calendar months (e.g. a water bill charged in January, March, July and October). At month creation, only the fixed expenses that apply to that month-number are cloned.

## Data model

- `template.months smallint[] NULL`.
  - `NULL` = **every month** (the default, and the meaning of every pre-existing row).
  - Non-null = the sorted, de-duplicated month-numbers (1–12) the template applies to.
- Check constraint `template_months_ck`: `months IS NULL OR (cardinality(months) BETWEEN 1 AND 11 AND months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}')`.
  - An empty schedule is impossible (a template that applies to no month is a deactivated template — use Deactivate).
  - A 12-month schedule is impossible: it is stored as `NULL` (see normalization).
- No FK points at `template` (month lines copy the fields at clone time), so a hard delete never orphans or rewrites month rows.

## Service (`src/server/services/templates.ts`)

- `normalizeMonths(months: number[] | null | undefined): number[] | null` — pure helper:
  - `null` / `undefined` → `null` (every month).
  - Integers outside 1–12 → `InvalidScheduleError`.
  - De-duplicate + sort ascending.
  - Empty after de-dup → `EmptyScheduleError`.
  - All 12 months → `null` ("advanced mode with every month selected is the same as no advanced mode").
- `createTemplate` / `updateTemplate` accept an optional `months` and persist `normalizeMonths(months)`. The edit form always sends the full schedule (`null` when the toggle is off); there is no partial patch.
- `deleteTemplate(userId, { id })` — HARD delete (`DELETE FROM template WHERE user_id = $1 AND id = $2`). Allowed on active and inactive rows. Missing row / other tenant → `TemplateNotFoundError`.
- `appliesToMonth(months, month)` — pure: `months === null || months.includes(month)`.

## Repository (`src/server/repositories/template.ts`)

- `listActiveTemplatesForMonth(userId, month, tx)` — clone source: `active = true AND (months IS NULL OR month = ANY(months))`.
- `deleteTemplate(userId, id, tx)` — hard delete, returns the deleted row or `null`.
- `insertTemplate` / `updateTemplate` write `months`.

## Consumers

- **UC-06 `createMonth`** clones `listActiveTemplatesForMonth(userId, input.month, tx)` instead of every active template (PRD C17 as amended).
- **UC-11 `getOverspendWarnings`** baseline = Σ active templates that **apply to the open month's month-number** (PRD §7.4 as amended). A water bill scheduled for January does not raise February's plan.
- Fixed expenses screen totals ("Total monthly expenses", "Distribution by category") stay the catalog view: Σ of every ACTIVE template regardless of schedule. They describe the catalog, not a specific month.

## Server actions (`src/actions/templates.ts`)

- `createTemplateAction` / `updateTemplateAction` gain `months: number[] | null` (Zod: array of integers 1–12, length 1–12, or `null`).
- New `deleteTemplateAction({ id })` → service → `revalidatePath('/[locale]/templates', 'page')`.
- New error codes: `"emptySchedule"` (no month picked) and `"invalidSchedule"`.

## Routes / UI (screen 7)

- **Schedule control** in both the add form and the inline edit form:
  - A checkbox **"Only in some months"** (off by default). Off → `months = null`.
  - On → a 12-cell month grid (locale short month names from `Intl`, never hardcoded): 4 columns × 3 rows on phones, 6 × 2 from `sm`, 12 × 1 from `md`. Each cell is a toggle button (`aria-pressed`), `h-11` touch target. Selected = sky-tint fill + navy text + navy border (STYLE-GUIDE §5 selection recipe). Turning the checkbox on pre-selects **all 12** months; the user deselects the ones that do not apply.
  - Zero months selected → inline keyed error, form not submitted. All 12 selected → saved as `null`; the row shows no schedule.
- **Schedule rail** on each row with a non-null schedule: a 12-segment strip (navy `--primary` segment = month applies, `--border` segment = month skipped) followed by the short month list ("Jan · Mar · Jul · Oct"). The strip is `aria-hidden`; the text carries the meaning.
- **Delete** lives inside the inline edit form (STYLE-GUIDE §5 Lists: "Delete lives inside the edit sheet, not as a row trash icon"): a destructive (red) ghost button **"Delete"** separated from Save/Cancel. Clicking it asks for confirmation (`window.confirm`, same pattern as month-line and income deletes) with copy that states the month copies are kept.

## i18n keys

- `templates.schedule.{toggle, help, everyMonth, legend, monthsList}`
- `templates.actions.{delete, confirmDelete}`
- `validation.{emptySchedule, invalidSchedule}`

## Acceptance criteria / tests (PRD §15 #35–#40)

- #35 Hard delete: "Gym 40" deleted → absent from the management list and from the clone query; a month created BEFORE the delete still has its "Gym 40" line; the `template` row is physically gone.
- #36 Schedule clone: "Water 60" with months {1, 3, 7, 10} + "Mortgage 800" (no schedule). Create Jan 2027 → both lines. Create Feb 2027 → only Mortgage.
- #37 Normalization: saving all 12 months stores `NULL`; saving zero months is rejected (`EmptyScheduleError`); `[3, 1, 3]` stores `{1, 3}`; `13` is rejected.
- #38 Overspend: Utilities templates "Water 60" months {1} + "Power 50" (no schedule); February actuals in Utilities 70 → warning (plan 50); January actuals 70 → no warning (plan 110).
- #39 Tenancy: user B cannot delete or reschedule user A's fixed expense (`TemplateNotFoundError`).
- #40 Editing or deleting a schedule never rewrites existing months (PRD §7.8).

## Depends on / unlocks

- Depends on: UC-05, UC-06, UC-11.
- Unlocks: —
