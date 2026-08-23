# UC-06 — Month creation, cloning & home navigation

> **Database:** already migrated (UC-00). Uses `month`, `month_fixed_line` (clone inserts), `template` (read active). No schema changes.
> **PRD refs:** UC-08, UC-14, UC-19; C6, C7, C12, C17; §7.8; §8 (lifecycle). Screens 3–4 (PRD §10).
> **ARCH refs:** §5 (transactions in the service layer), §7 (`last_opened_month` cookie).

## Goal

The heart of the app: manual month creation with the one-time template clone, plus home/month-list navigation with the resume cookie. Nothing ever creates a month implicitly (PRD C6/C12).

## Service (`src/server/services/months.ts`)

- `createMonth(userId, year, month)` — ONE transaction (ARCH §5):
  1. Reject if `(user_id, year, month)` already exists — the unique index backs this (PRD UC-08).
  2. Insert the `month` row.
  3. `SELECT` the user's ACTIVE templates → `INSERT` one `month_fixed_line` row per template: `category_id`, `name`, `observations` copied; `remaining_amount = amount`; `original_amount = amount`; `kind` copied; `origin = 'cloned'` (PRD C17, §8).
- `getMonthList(userId)` — newest first (PRD UC-14).
- `getMonthWorkspace(userId, year, month)` — month header + reserved lines grouped by kind. (Incomes block arrives in UC-07, actuals in UC-08, summary in UC-11.)

## Routes / UI

- `[locale]/page.tsx` (home, screen 3):
  - Read the `last_opened_month` cookie → open that month ONLY if it exists; otherwise fall through (PRD UC-14, C12).
  - Month list, newest first, + a create-month form (month/year picker).
  - Empty state: create month only — copy per PRD §19: "Create a month to start. Nothing is created automatically."
- `[locale]/months/[year]/[month]/page.tsx` (screen 4 skeleton): renders the cloned reserved lines read-only (editing lands in UC-09). Opening a month sets the `last_opened_month` cookie.

## Rules

- Duplicate creation is rejected; never clone twice (PRD UC-08).
- After creation the month is independent: later template edits/soft-deletes do not rewrite it; months never sync with each other (PRD §7.8, UC-19).
- No rollover of unused remainings into the next month (PRD C7).
- Incomes are NOT cloned (PRD §7.8).

## Acceptance criteria / tests (PRD §15)

- #3 Creating Aug 2026 twice → second attempt fails with a keyed error.
- #4 With zero months, home shows only the create-month empty state; nothing is auto-created.
- Clone snapshot: with active templates "Mortgage 800 committed" + "Groceries 400 estimated", the new month contains exactly those 2 reserved lines with `remaining = original = template amount`.
- Inactive templates are not cloned; soft-deleting a template after creation leaves the month unchanged.
- Cookie resume: reopening home lands on the last opened month when it still exists.

## Depends on / unlocks

- Depends on: UC-01, UC-02, UC-03, UC-05.
- Unlocks: UC-07, UC-08, UC-09 (the month workspace content slices).
