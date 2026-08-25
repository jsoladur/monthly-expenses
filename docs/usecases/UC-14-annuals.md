# UC-14 — Annuals (yearly recurring expense reminders)

> **SCHEMA CHANGE — EXCEPTION:** this is the FIRST slice that modifies the database after UC-00. It adds the `annual` table (already in `docs/database/database.dbml`). Generate migration `0002` with `drizzle-kit`. Every other schema rule stays unchanged.
> **PRD status:** NOT in the PRD v1 — Product Owner decision 2026-08-25. To be merged into `docs/prds/GLOBAL.md` (§6 model, §9 use cases, §10 screens, §13 delete policy). Until then, THIS file is the behavior source of truth for Annuals.
> **PRD refs (extended):** §6 catalog pattern, §10 screens, §13 (catalogs = soft delete), C10 (per-user global catalogs), §7.4 philosophy (warn only, never block).
> **ARCH refs:** §5 (layering), ADR-4 (drizzle-kit migration), ADR-6 (server actions).

## Goal

A per-user catalog of **yearly recurring expenses** (e.g., annual insurance, AMPA fee, vehicle tax) plus **reminders in the month workspace**: when the open month's month-number matches an annual's charge month — September of ANY year — show one reminder per matching annual prompting the user to MANUALLY add an estimated/committed line. Annuals never auto-create anything (consistent with PRD C6/C12 philosophy).

## Schema change (migration 0002 + 0003)

New table `annual` (singular naming convention):

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid fk → `app_user` | Tenancy (PRD §5.1) |
| `category_id` | uuid fk → `category` | Expense category; must be ACTIVE at creation |
| `name` | text | Mandatory |
| `observations` | text null | The "optional notes" field |
| `amount` | numeric(14,2) null | Optional reference amount in the user's currency; shown in reminder cards when set |
| `charge_month` | int | 1–12, month of the year when usually charged; `CHECK (charge_month BETWEEN 1 AND 12)` |
| `is_direct_debit` | boolean | "¿Domiciliado?" — default `false` |
| `active` / `deleted_at` | boolean / timestamptz | Soft delete (catalog rule, PRD §13); inactive annuals raise NO reminders |
| `created_at` / `updated_at` | timestamptz | — |

Index: `(user_id, charge_month)` — the reminder query. The `amount` column is optional (nullable) — when set, the reminder card shows the reference amount; when null, the user is expected to enter the amount manually.

## Server actions (`src/actions/annuals.ts`)

- `createAnnual({ categoryId, name, observations?, amount?, chargeMonth, isDirectDebit })`
- `updateAnnual({ id, ...same })`
- `deactivateAnnual({ id })` / `reactivateAnnual({ id })` — soft delete toggle.

## Service / repository

- `listAnnuals(userId)` — management screen, ordered by `charge_month` then name.
- `getAnnualReminders(userId, month)` — `WHERE user_id = $1 AND charge_month = $2 AND active = true`. Called by the month workspace RSC with the open month's month-number (any year).

## Routes / UI

- `[locale]/annuals` — new principal menu item "Annuals": management list grouped/sorted by charge month (month names from locale, PRD §11), with a "Domiciliado / Direct debit" badge when `is_direct_debit`. Optional amount displayed when set.
- Navigation: add Annuals to the mobile bottom nav and desktop sidebar — now 5 items (Month · Annuals · Categories · Templates · Settings), per STYLE-GUIDE §4.
- Month workspace: reminder cards stacked under the summary hero, one per matching annual — sky-tint info card (NOT amber: reminders are informational, warnings stay amber per STYLE-GUIDE §5), bell icon, name + category + amount (when set) + direct-debit badge.
- Each reminder card has a **Quick-add** button: opens the UC-13 one-off expense form PREFILLED with the annual's name + category; the user picks kind (`estimated`/`committed`) and types the amount. It never auto-creates — it only prefills UC-09's `addMonthOnlyLine` form.

## Rules

- Warn only, never block; reminders are purely informational (PRD §7.4 philosophy).
- Reminders show for ANY year — matching is by month-number only.
- Reminders do NOT disappear after adding a line (no dismissal tracking in MVP — future enhancement).
- Soft-deleted annuals raise no reminders and stay in history nowhere (they are a pure catalog; nothing references them from months).
- Tenancy: every query filters `user_id` (P0).

## i18n keys

- `annuals.*` (title, form labels incl. `annuals.isDirectDebit` = "Direct debit" / "Domiciliado", `annuals.amount` = "Amount" / "Importe", `annuals.amountOptional` = "Amount (optional)" / "Importe (opcional)")
- `reminders.annual` = en: "Usually charged in {month}. Add an estimated/committed line manually if it applies this year." · es: "Suele cargarse en {month}. Añade manualmente una línea estimada/comprometida si aplica este año."

## Acceptance criteria / tests

- Unit: `getAnnualReminders` filters by `charge_month`, `active`, and `user_id`.
- Integration: tenancy — user B never sees user A's annuals or reminders.
- E2E: create annual "AMPA fee" (charge_month = 9, domiciliado = true, amount = 300.00) → open/create September 2026 → reminder card visible with amount → open October 2026 → not visible → open September 2027 → visible again (any year).
- E2E: Quick-add prefills the one-off form; nothing is created until the user confirms.
- Soft-deleted annual → no reminder; reactivated → reminder returns.
- Migration 0002 applies cleanly on Postgres 16 (incl. the `charge_month` CHECK). Migration 0003 adds the optional `amount` column.

## Depends on

- UC-03 (expense categories), UC-06 (month workspace). Recommended after UC-11 (warning/banner UI patterns) and UC-13 (one-off form reused by Quick-add).
