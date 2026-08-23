# UC-00 — Foundations & database bootstrap

> **Database:** this slice CREATES the entire schema in one migration, from `database.dbml` (= ARCH §4). All later slices assume it exists and change nothing.
> **PRD refs:** C5 (Compose = app + PostgreSQL), C9 (amount input format), §16 (implementation notes).
> **ARCH refs:** §1–2 (ADR-1 Next.js BFF, ADR-4 Drizzle, ADR-5 money, ADR-9 Tailwind/shadcn, ADR-10 Vitest/Playwright), §5 (layering), §6 (structure), §8 (money), §9 (compose/env), §10 (scaffolding).

## Goal

A runnable, deployable skeleton: repo scaffolded per ARCH §10, Docker Compose with `app` + `postgres:16-alpine`, the full Drizzle schema migrated, shared money/validation helpers, and test tooling. No product behavior yet.

## Tasks

1. Scaffold per ARCH §10: `create-next-app` (TS, Tailwind, ESLint, App Router, `--src-dir`, turbopack), then `next-auth@beta drizzle-orm postgres zod next-intl`, dev deps `drizzle-kit tsx`, `shadcn init`, `@serwist/next serwist`, `vitest playwright @playwright/test`.
2. Write `src/server/db/schema.ts` implementing `database.dbml` 1:1 — 8 tables (`app_user`, `profile_settings`, `category`, `template`, `month`, `month_income`, `month_fixed_line`, `month_actual_expense`) and 3 enums (`category_kind`, `line_kind`, `line_origin`). Table names are SINGULAR; `app_user` is used because `user` is reserved in PostgreSQL.
3. Generate the first migration with `drizzle-kit` and add the two things DBML cannot express as raw SQL in that migration:
   - Partial unique index: `CREATE UNIQUE INDEX category_active_name_uk ON category (user_id, kind, name) WHERE active;` (PRD §6.2)
   - `CHECK (month BETWEEN 1 AND 12)` on `month.month`
   - Do NOT create an FK on `month_actual_expense.converted_from_line_id` (logical reference only — the source line is hard-deleted by pass-to-actual; undo re-inserts it with the same id).
4. `docker-compose.yml` + multi-stage `Dockerfile` per ARCH §9; migrations run on container start (`drizzle-kit migrate` or a one-shot migrate service).
5. `.env.example` listing: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` (ARCH §9).
6. `src/server/money.ts`: `parseAmount("1234.56") → integer cents`, `formatCents(cents) → "1234.56"`, sum helpers. Negatives supported; floats forbidden (ARCH §8).
7. Shared Zod amount schema: `^-?\d{1,12}\.\d{2}$` (ARCH §5 rule 4; PRD C9 dot-decimal input).
8. Repository convention: every function signature is `(userId, ...)`; document the rule in `AGENTS.md`, which also points to `docs/prd.md` and `docs/architecture.md`.
9. Vitest config (`tests/unit`, `tests/integration` against the compose Postgres) and Playwright config (`tests/e2e`).

## Acceptance criteria

- `docker compose up` yields a healthy app and db; the migration applies cleanly; `\dt` shows the 8 tables and `\dT` the 3 enums.
- `money.ts` unit tests are green, including `"-20.00" → -2000` cents and round-trip formatting (PRD §7.6).
- No `float`/`number` arithmetic on amounts anywhere (ADR-5).

## Tests

- Unit: money helpers (parse/format/sum, negatives, 2-decimal enforcement).
- Integration: migration smoke test — schema applies on empty Postgres 16.

## Depends on / unlocks

- Depends on: nothing.
- Unlocks: every other use-case file.
