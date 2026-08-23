# UC-08 — Actual expenses (tickets)

> **Database:** already migrated (UC-00). Uses `month_actual_expense`, `category` (expense kind). No schema changes.
> **PRD refs:** UC-10, UC-16; §6.7; C13 (free-text name), C15 (hard delete); §7.2–7.3 (tickets never auto-reduce envelopes).
> **ARCH refs:** §5, ADR-6. Month workspace screen 4 — add-actual is the primary mobile action (PRD §10).

## Goal

Unlimited real-expense tickets per month: add, edit, hard-delete. Adding a ticket NEVER changes any `remaining_amount` (PRD §7.2/§7.3).

## Server actions (`src/actions/actuals.ts`)

- `addActual({ monthId, categoryId, name, observations?, amount })`
- `editActual({ id, categoryId, name, observations?, amount })` — MUST set `edited_after_conversion = true` unconditionally (harmless for normal tickets; it is the undo gate for converted ones — UC-10 depends on this).
- `deleteActual({ id })` — HARD delete (PRD C15); excluded from sums by being gone (PRD §7.1).

## Rules

- Category must be an ACTIVE expense category at creation (PRD §6.7); old tickets keep displaying a since-deactivated category's name (PRD §6.2).
- `name` is free text — no autocomplete (PRD C13); `observations` optional.
- `amount` may be negative; totals are algebraic sums (PRD §7.6, UC-16).
- No side effects on `month_fixed_line` — never auto-balance envelopes (PRD §16).

## Routes / UI

- Actuals block inside the month workspace: ticket list + add/edit/delete. The add-actual form is the mobile-first hero action of screen 4 (PRD §10).

## i18n keys

- `actuals.*`, `validation.*`

## Acceptance criteria / tests (PRD §15)

- #14 An actual of −20 increases potential savings by 20 (sum verified in UC-11).
- #15 Hard-deleting an actual removes it from all sums.
- #11 (with UC-03): an inactive category is rejected on a new ticket; the old ticket still displays.
- Tenancy: tickets are only reachable through a month owned by the session user.

## Depends on / unlocks

- Depends on: UC-06.
- Unlocks: UC-10 (pass-to-actual creates rows here), UC-11 (sums).
