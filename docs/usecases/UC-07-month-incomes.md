# UC-07 — Month incomes

> **Database:** already migrated (UC-00). Uses `month_income`, `category` (income kind). No schema changes.
> **PRD refs:** UC-09; §6.5; C15 (hard delete); §7.8 (incomes are not cloned).
> **ARCH refs:** §5, ADR-6. Month workspace screen 4 (PRD §10).

## Goal

Add, edit, and hard-delete income rows inside a month instance. Incomes belong to one month only and are never cloned from templates (PRD §7.8).

## Server actions (`src/actions/incomes.ts`)

- `addIncome({ monthId, categoryId, name, amount })`
- `editIncome({ id, categoryId, name, amount })`
- `deleteIncome({ id })` — HARD delete (PRD C15); the row is gone from all sums.

## Rules

- Category must be an ACTIVE income category at creation (PRD §6.5); old incomes keep displaying a since-deactivated category's name.
- `name` and `amount` are mandatory; there is NO observations field (PRD §6.5).
- `amount` may be negative (PRD UC-16); wire format `"1234.56"`, cents in the service (ARCH §8).
- Tenancy: resolve the month by `(userId, monthId)` before touching its incomes (PRD §5.1).

## Routes / UI

- Incomes block inside `[locale]/months/[year]/[month]` — list + add/edit/delete, mobile-first.

## i18n keys

- `incomes.*`, `validation.*`

## Acceptance criteria

- CRUD works on any existing month (including past months — the warning banner is UC-11).
- Hard-deleted income disappears from the database and from totals.
- Inactive income category is rejected on create; historical incomes still render.

## Tests

- Integration: add/edit/hard-delete flow; tenancy (user B cannot touch user A's month incomes).
- Feeds PRD §15 #5 (income 2000 in the savings scenario, verified in UC-11).

## Depends on

- UC-06 (month workspace exists).
