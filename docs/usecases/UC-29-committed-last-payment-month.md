# UC-29 — Last payment month for committed fixed expenses (loans & instalments)

> **Database:** **adds two columns** — `template.end_year smallint` and `template.end_month smallint` (both nullable) + check constraint `template_end_ck`, via migration 0007. Product Owner decision 2026-11-11.
> **PRD refs:** **UC-31** / **C29**; §6.3; §7.4; §7.8; §8. Screen 7 (PRD §10).
> **ARCH refs:** §4 (data model), §5 (layering), §8 rule 4 (overspend baseline).

## Goal

Some committed fixed expenses are small credits or loans: they are paid every month until a known **last payment month**, then they stop. Today the user has to remember to deactivate them.

A **committed** fixed expense may now carry an optional **last payment month** (month + year). When the user creates a month, the app:

1. copies the fixed expense into that month only if the month is not after its last payment month, and
2. **deactivates** (never deletes) every fixed expense whose last payment month has been reached.

A paid-off loan therefore stops being copied into new months without any manual step, and stays in the catalog as an inactive row.

## Product Owner decisions (2026-11-11)

- **Committed only.** Estimated fixed expenses cannot have a last payment month.
- **The last payment month is included.** A loan ending March 2027 is copied into March 2027 and into no later month.
- **Skipped month.** The trigger is "a month on or after the last payment month is created", not "that exact month is created". Creating April 2027 without ever creating March 2027 does not copy the loan and deactivates it.
- **Deactivate, never delete.** Auto-deactivation is the same soft delete as the Deactivate button (`active = false`, `deleted_at = now()`).
- **Reactivate clears it.** Reactivating a fixed expense removes its last payment month, so it is copied into every new month again until the user sets a new one.

## Data model

- `template.end_year smallint NULL`, `template.end_month smallint NULL`.
  - Both `NULL` = no last payment month (the default, and the meaning of every pre-existing row).
  - Both set = the last calendar month the fixed expense is paid.
- Check constraint `template_end_ck`:
  `(end_year IS NULL AND end_month IS NULL) OR (end_year IS NOT NULL AND end_month IS NOT NULL AND kind = 'committed' AND end_month BETWEEN 1 AND 12 AND end_year BETWEEN 1970 AND 9999)`.
- Months compare by `index = year * 12 + (month − 1)` (same rule as UC-26).
- Nothing is stored on `month_fixed_line`: the copied line is a plain snapshot, as always (PRD §7.8).

## Pure helpers (`src/lib/template-end.ts`)

- `normalizeEndMonth(kind, end)` → `{ year, month } | null`
  - `null` / `undefined` → `null`.
  - Set on an `estimated` template → `EndMonthOnEstimatedError`.
  - Non-integer, month outside 1–12 or year outside 1970–9999 → `InvalidEndMonthError`.
- `isCopiedInto(end, period)` — `end === null || index(period) <= index(end)`.
- `hasEndedBy(end, period)` — `end !== null && index(period) >= index(end)`.

## Repository (`src/server/repositories/template.ts`)

Every function takes `userId` first and filters by it.

- `listTemplatesToClone(userId, year, month, tx)` — replaces `listActiveTemplatesForMonth` as the clone source:
  `active AND (months IS NULL OR month = ANY(months)) AND (end_year IS NULL OR index(year, month) <= index(end))`.
- `deactivateEndedTemplates(userId, year, month, tx)` — one `UPDATE … SET active = false, deleted_at = now()` on rows with `active AND end_year IS NOT NULL AND index(end) <= index(year, month)`; returns the deactivated rows.
- `listPlanTemplatesForMonth(userId, year, month, tx)` — overspend baseline (see Consumers).
- `insertTemplate` / `updateTemplate` write `end_year` / `end_month`.
- `reactivateTemplate` also sets `end_year = NULL, end_month = NULL`.

## Service

### `src/server/services/templates.ts`

- `createTemplate` / `updateTemplate` accept an optional `endMonth: { year, month } | null` and persist `normalizeEndMonth(kind, endMonth)`. The edit form always sends the full value (`null` when the toggle is off); there is no partial patch.
- Saving a last payment month **never** deactivates anything by itself, even when months on or after it already exist. Deactivation happens only at month creation.
- `reactivateTemplate` clears the last payment month (PO decision).

### `src/server/services/months.ts` — `createMonth`

Inside the existing transaction, in this order:

1. insert the `month` row;
2. clone `listTemplatesToClone(userId, year, month, tx)`;
3. `deactivateEndedTemplates(userId, year, month, tx)`.

Consequences:

| Created month vs last payment month | Copied? | Template afterwards |
| --- | --- | --- |
| Before | Yes | Active |
| Same month | Yes (the last payment) | **Inactive** |
| After (the last payment month was never created) | No | **Inactive** |

- A month schedule (UC-20) still applies: "Insurance instalment" scheduled {Jan, Jul} with last payment March 2027 is not copied into March 2027, but creating March 2027 deactivates it.
- Creating a month **before** the last payment month (back-filling) never deactivates.
- Once a fixed expense is inactive it is not copied anywhere, including into an older month created later. The user reactivates it (and sets the month again) if they need that.
- Existing months are never rewritten (PRD §7.8). If the month insert fails (duplicate), the transaction rolls back and nothing is deactivated.

## Consumers

- **UC-11 `getOverspendWarnings`** baseline uses `listPlanTemplatesForMonth`. A fixed expense that applies to the open month-number counts toward the plan when:
  - it has **no** last payment month and is **active** (unchanged rule), or
  - it **has** a last payment month and the open month is **not after** it — active or not.

  Without the second rule the loan would vanish from the plan of its own last month the moment that month is created, and the loan's ticket would raise a false overspend warning.
- A fixed expense deactivated **by hand** before its last payment month also keeps counting until that month (the row cannot tell the two cases apart). Accepted edge.
- **Fixed expenses totals** ("Total monthly expenses", "Distribution by category") stay Σ of ACTIVE templates. A paid-off loan drops out of them when it is deactivated.

## Server actions (`src/actions/templates.ts`)

- `createTemplateAction` / `updateTemplateAction` gain `endMonth: { year: number; month: number } | null` (Zod: `yearSchema` + `monthSchema`, or `null`).
- New error codes: `"endMonthOnEstimated"` and `"invalidEndMonth"`.
- `createMonthAction` is unchanged; it already revalidates. `createMonth` now also changes `template` rows, so the action additionally revalidates `/[locale]/templates`.

## Routes / UI (screen 7)

- **Last payment control** in the add form and the inline edit form, **Committed tab only**, below the month schedule:
  - A checkbox **"Has a last payment"** (off by default) with the hint "For loans and instalments." Off → `endMonth = null`.
  - On → a month `<select>` (locale month names from `Intl`) and a year number input (four digits, 1970–9999; no native `min`/`max`, so an invalid year shows the keyed `validation.invalidEndMonth` instead of the browser's untranslated bubble). Turning it on starts at the current calendar month, or restores the value picked before it was switched off in the same form.
  - Below the two inputs: "Copied for the last time in {month}. Creating that month deactivates this fixed expense."
- **Row note** on every row with a last payment month: a small calendar-check icon and "Last payment: {month year}" in the row's caption line (`aria-hidden` icon; the text carries the meaning). Active and inactive rows use the same note; inactive rows keep the existing "Inactive" badge.
- **Reactivate** on a row that has a last payment month asks for confirmation (`window.confirm`) and says that the last payment month will be cleared.

## i18n keys

- `templates.endMonth.{toggle, help, legend, month, year, note, rowLabel}`
- `templates.actions.confirmReactivateEnded`
- `validation.{endMonthOnEstimated, invalidEndMonth}`

## Acceptance criteria / tests (PRD §15 #66–#73)

- #66 "Car loan 250" committed, last payment Mar 2027. Create Feb 2027 → line copied, template active. Create Mar 2027 → line copied, template inactive (row still exists). Create Apr 2027 → no Car loan line.
- #67 Skipped month: last payment Mar 2027; create May 2027 first → no line, template inactive.
- #68 Back-fill: last payment Mar 2027; create Jan 2027 → line copied, template still active.
- #69 Validation: an estimated fixed expense with a last payment month is rejected (`EndMonthOnEstimatedError`); month 13 or year 1969 is rejected (`InvalidEndMonthError`); the DB check rejects half-set values and an estimated row written directly.
- #70 Reactivate clears the last payment month; the next created month copies the fixed expense again and leaves it active.
- #71 Overspend: Loans "Car loan 250" with last payment Mar 2027, ticket 250 in Mar 2027 → no warning in March (plan 250) although the template is now inactive. In Apr 2027 the plan no longer counts it.
- #72 Tenancy: user B cannot set a last payment month on user A's fixed expense; creating user B's month never deactivates user A's fixed expenses.
- #73 Schedule + last payment: scheduled {Jan, Jul}, last payment Mar 2027 → creating Mar 2027 copies nothing and deactivates it. Existing months are never rewritten by any of the above.

## Depends on / unlocks

- Depends on: UC-05, UC-06, UC-11, UC-20.
- Unlocks: —
