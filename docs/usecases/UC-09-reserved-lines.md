# UC-09 — Reserved lines: edit remaining & month-only lines

> **Database:** already migrated (UC-00). Uses `month_fixed_line`, `category` (expense). No schema changes.
> **PRD refs:** UC-11, UC-18; §6.6; §7.3; §7.8.
> **ARCH refs:** §5, ADR-6. Month workspace screen 4.

## Goal

Manage the month's reserved (fixed/estimated) lines after cloning: manual remaining edits and one-off month-only lines. Editing a remaining NEVER creates an actual ticket (PRD UC-11).

## Server actions (`src/actions/reserved-lines.ts`)

- `updateRemainingAmount({ lineId, remainingAmount })` — allowed for `committed` AND `estimated` lines; manual edit only; zero and negative values are accepted (PRD §7.4).
- `addMonthOnlyLine({ monthId, categoryId, name, observations?, amount, kind })` — inserts with `origin = 'month_only'`, `remaining_amount = original_amount = amount`.
- `deleteMonthLine({ lineId })` — HARD delete; never touches `template` (PRD §6.6).

## Rules

- Month-only lines live only on their instance: the NEXT month's clone ignores them unless they were added to the templates before that month is created (PRD UC-18, §7.8).
- Editing August's remaining never leaks into September (PRD UC-19).
- Actual tickets do not auto-reduce these remainings (PRD §7.3) — the UI must make the remaining obvious and easy to edit.

## Routes / UI

- Reserved-lines block in the month workspace, grouped by `kind` (committed / estimated), with a prominent inline remaining editor.
- Estimate help copy per PRD §19: "Tickets do not reduce this number. Decrease it yourself when you want the reserve to drop."

## i18n keys

- `reservedLines.*`, `validation.*`

## Acceptance criteria / tests (PRD §15)

- #7 Setting groceries remaining 400 → 350 raises potential savings to 800 (sum verified in UC-11).
- #17 A one-off August line of 30 does NOT appear in a September created afterwards.
- #18 August grocery remaining edited to 100 → September still clones the template's 400.
- Hard-deleting a cloned or month-only line removes it from sums and leaves templates intact.

## Depends on / unlocks

- Depends on: UC-06.
- Unlocks: UC-10 (pass-to-actual operates on these lines), UC-11 (sums).
