# UC-27 — Delete a month

> **Database:** **no schema change.** `month_income`, `month_fixed_line` and `month_actual_expense` already reference `month.id` with `ON DELETE CASCADE` (migration 0000).
> **PRD refs:** **UC-29** / **C27** (merged into `docs/prds/GLOBAL.md` 2026-11-04); fulfils PRD §13 "Month header — Not required in V1; if later, cascade hard-delete children". Screens 3 and 4 (PRD §10). The PRD wins for behavior; this file is the detailed slice.
> **ARCH refs:** §5 (layering), §3.2 (`requireUserId()`).

## 0. Why this exists

A month created by mistake (wrong month or year picker) cannot be removed. Because months clone templates once (C17), the only fix today is living with a wrong month — or re-creating it is blocked (§6.4 "reject twice").

## 1. Goal

Permanently delete a month and everything inside it, behind a deliberate confirmation.

## 2. Out of scope

- Undo / trash / soft delete of months.
- Deleting several months at once.
- Any change to templates, categories or annuals.

## 3. Rules

- Hard delete of the `month` row; children go by cascade. One transaction.
- Confirmation requires typing the localized month label exactly as shown (e.g. `November 2026` / `noviembre 2026`), case-insensitive, trimmed. The server re-validates the month id and ownership; the typed label is a UI guard only.
- After delete: if the `last_opened_month` cookie points at it, clear the cookie; redirect to Home (month list). Home never auto-picks or creates another month (C6/C12).
- The same month/year can then be created again, cloning **today's** templates (expected and stated in the confirm copy).
- Search, Stats and Export simply stop seeing the deleted rows.

## 4. Service (`src/server/services/months.ts`)

- `deleteMonth(userId, { monthId })` → `MonthNotFoundError` if not owned; returns `{ year, month }` of the deleted month.
- Repository `month.ts`: `deleteMonth(userId, monthId, tx)` — `DELETE FROM month WHERE user_id = $1 AND id = $2 RETURNING year, month`.

## 5. Server actions (`src/actions/months.ts`)

- `deleteMonthAction({ monthId })` → Zod → service → clear cookie if it matches → `revalidatePath('/[locale]', 'layout')` → `redirect` to the locale Home.

## 6. UI

- Month workspace header overflow menu (`MoreHorizontal`) → **Delete month** (destructive item, last in the menu).
- Dialog: title "Delete {month} {year}?"; body lists the counts that will be removed (incomes, reserved lines, actual expenses) and "Your templates and categories are not touched. If you create this month again it copies your current fixed expenses."; a text input "Type {month} {year} to confirm"; destructive button enabled only when it matches.

## 7. i18n keys

- `month.delete.{menu, title, body, counts, typeToConfirm, confirm, done}`

## 8. Acceptance criteria / tests (PRD §15 #58–#61)

- #58 Delete Nov 2026 with 2 incomes, 5 lines, 7 actuals → all rows gone; other months untouched; Search no longer returns its tickets.
- #59 Re-create Nov 2026 after delete → succeeds and clones current active templates for month-number 11.
- #60 Last-opened cookie pointing at the deleted month is cleared; Home shows the month list, no month is created.
- #61 Tenancy: user B cannot delete user A's month (`MonthNotFoundError`), and nothing of user A's is removed.

## 9. Depends on / unlocks

- Depends on: UC-06.
- Unlocks: —
