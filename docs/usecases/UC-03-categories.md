# UC-03 — Categories (expense & income)

> **Database:** already migrated (UC-00). Uses `category`. No schema changes.
> **PRD refs:** UC-05, UC-06; C10; §6.2; §13 (soft delete).
> **ARCH refs:** §5 (layering), ADR-6 (server actions). Screens 5–6 (PRD §10).

## Goal

Per-user global catalogs of expense and income categories with soft delete. Categories are never cloned into months (PRD C10); month rows reference them by id and keep displaying the name even after deactivation (PRD §6.2).

## Server actions (`src/actions/categories.ts`)

- `createCategory({ kind, name })` — `kind` = `expense | income`; name mandatory, unique per `(user_id, kind)` among ACTIVE rows (backed by the partial unique index from UC-00).
- `renameCategory({ id, name })` — same uniqueness rule.
- `deactivateCategory({ id })` — soft delete: `active=false`, `deleted_at=now()`.
- `reactivateCategory({ id })` — `active=true`, `deleted_at=null`; must re-check the active-name uniqueness first (PRD §6.2 allows reactivation).

All actions: Zod-parse input → service → `revalidatePath`. No business logic in the action (ARCH §5 rule 3).

## Service / repository

- `listCategories(userId, kind, { includeInactive })` — management screen.
- `listActiveCategories(userId, kind)` — pickers for new tickets/incomes/template lines.
- Rule: an inactive category is rejected when creating NEW actuals, incomes, or template lines; existing month rows still display its name via the FK join (PRD §6.2).

## Routes / UI

- `[locale]/categories` — one screen with expense/income tabs: list, create, rename, deactivate/reactivate (screens 5–6).

## i18n keys

- `categories.*`, `validation.duplicateCategoryName`, `validation.required`

## Acceptance criteria

- CRUD + reactivate work per kind; duplicate active names are rejected with a keyed validation error.
- Deactivated category disappears from all new-entry pickers; historical rows still show its name.
- No physical `DELETE` ever runs on `category` (PRD §13).

## Tests (PRD §15)

- #16 Soft-delete → hidden from pickers, history intact.
- Picker half of #11 (inactive category blocked on a new ticket) — the creation-side validation lands in UC-08.

## Depends on / unlocks

- Depends on: UC-01 (tenancy), UC-02 (keyed strings).
- Unlocks: UC-05 (templates need expense categories), UC-07/UC-08 (pickers).
