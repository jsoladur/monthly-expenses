# UC-10 — Pass reserved line to actual (+ undo)

> **Database:** migration 0004 adds `converted_line_kind` column to `month_actual_expense` to track the original line kind for undo. Uses `month_fixed_line`, `month_actual_expense` (incl. `converted_from_line_id`, `converted_line_original_amount`, `converted_line_origin`, `converted_line_kind`, `edited_after_conversion`).
> **PRD refs:** UC-12; §7.2 (no double-count); §7.5 (normative).
> **ARCH refs:** §4 (undo link), §5 (transactions live in the service layer).

## Goal

One-tap cut-paste of a reserved month line (committed OR estimated) into actuals, with undo allowed only while the created actual has not been edited (PRD §7.5).

## Service (`src/server/services/pass-to-actual.ts`) — each operation in ONE db transaction

- `passToActual(userId, lineId)`:
  1. Load the line scoped to the user (via its month); 404 if not found.
  2. Insert `month_actual_expense`: `month_id`, `category_id`, `name`, `observations` copied; `amount = line.remaining_amount`; `converted_from_line_id = line.id`; `converted_line_original_amount = line.original_amount`; `converted_line_origin = line.origin`; `converted_line_kind = line.kind`; `edited_after_conversion = false`.
  3. HARD-delete the source line.
  After the move the money exists ONLY in actuals (PRD §7.2).
- `undoPassToActual(userId, actualId)`:
  1. Allowed ONLY if `converted_from_line_id IS NOT NULL` AND `edited_after_conversion = false`.
  2. Re-insert `month_fixed_line` REUSING `converted_from_line_id` as the row id: `remaining_amount = actual.amount`, `original_amount = converted_line_original_amount`, `kind = converted_line_kind` (preserves original kind), `origin = converted_line_origin`, name/observations/category copied back.
  3. HARD-delete the actual.
- Once the user edits the actual, UC-08's `editActual` has already set `edited_after_conversion = true` → no un-convert. The manual escape hatch is hard-delete + re-add (PRD §7.5).
- After conversion the user may edit the actual's amount freely (PRD §7.5).

## Routes / UI

- "Pass to actual" action rendered on BOTH committed and estimated lines in the workspace; Undo affordance shown while the gate allows it.
- Copy per PRD §19: "Move this reserved line to actual spend."

## i18n keys

- `passToActual.*`, `validation.*`

## Acceptance criteria / tests (PRD §15)

- #8 Passing the mortgage to actuals leaves potential savings unchanged at 800, and the money appears only in actuals (sum verified in UC-11).
- #9 Undo on an unedited actual restores the fixed line.
- #10 After editing the actual, undo is rejected.
- Estimated lines can now be passed to actuals (extension of original UC-10).
- Undo restores the line with its original kind (committed or estimated).
- Both operations are atomic: a failure mid-way leaves no partial state (ARCH §5).

## Depends on

- UC-08 (actuals + the `edited_after_conversion` gate), UC-09 (reserved lines UI).
