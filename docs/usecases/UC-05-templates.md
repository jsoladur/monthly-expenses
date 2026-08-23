# UC-05 — Fixed/estimated templates catalog

> **Database:** already migrated (UC-00). Uses `template`, `category` (expense pickers). No schema changes.
> **PRD refs:** UC-07; §6.3; §13 (soft delete); C10. Screen 7 (PRD §10).
> **ARCH refs:** §5 (layering), ADR-6.

## Goal

The per-user management form for reusable fixed (`committed`) and estimated (`estimated`) lines. Templates are the CLONE SOURCE used only at month creation (PRD C17); they are never updated from month edits (PRD §6.3).

## Server actions (`src/actions/templates.ts`)

- `createTemplate({ categoryId, name, observations?, amount, kind })`
- `updateTemplate({ id, categoryId, name, observations?, amount, kind })`
- `deactivateTemplate({ id })` / `reactivateTemplate({ id })` — soft delete toggle (`active`, `deleted_at`).

## Rules

- `kind` (`committed | estimated`) is mandatory; category must be an ACTIVE expense category.
- `amount` arrives as a `"1234.56"` string, may be negative (PRD §7.6); stored as `numeric(14,2)`, handled as integer cents in the service (ARCH §8).
- Inactive/soft-deleted templates are NOT cloned into future months; months that already exist are untouched (PRD §6.3, §7.8).
- Editing a template never rewrites existing months (PRD §7.8).

## Routes / UI

- `[locale]/templates` — list grouped by kind with active toggle and edit form (screen 7). Include the PRD §19 "Clone" copy: "Fixed and estimated lines are copied when the month is created. This month is independent after that."

## i18n keys

- `templates.*`, `validation.*`

## Acceptance criteria

- Full CRUD with soft delete/reactivate.
- Deactivated template is excluded from the clone query (verified end-to-end in UC-06 tests).
- Amounts accept and display negatives.

## Tests

- Unit: template service validation (kind, active category, amount parsing).
- Integration: soft-deleted template absent from the active-templates query used by cloning.

## Depends on / unlocks

- Depends on: UC-03 (expense categories).
- Unlocks: UC-06 (month creation clones active templates).
