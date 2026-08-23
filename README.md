# Monthly Expenses

A personal, multi-tenant PWA for tracking one calendar month at a time — incomes,
reusable categories, fixed commitments, estimated envelopes, and actual tickets.
See [`docs/README.md`](docs/README.md) for the full product + architecture docs.

## Stack

Next.js 16 (App Router, standalone output) · Auth.js v5 (Google + env-var
allowlist) · PostgreSQL 16 · Drizzle ORM · Tailwind + shadcn/ui · next-intl ·
Serwist (PWA) · Vitest + Playwright. One `Dockerfile` ships the whole BFF; a
`docker-compose.yml` adds a bundled Postgres for local dev.

## Local development

```bash
cp .env.example .env
# Fill in AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, ALLOWED_EMAILS at minimum.
docker compose up --build
```

Compose starts `app` (port `3000`) and `db` (internal network `expenses-net`)
and runs the Drizzle migrations from `scripts/migrate.mjs` before the Next.js
server boots.

For non-Docker development:

```bash
pnpm install
DATABASE_URL=postgres://... pnpm dev
pnpm test            # unit + integration (skips integration if no DB)
pnpm typecheck
pnpm lint
```

## Docker Hub deployment

The image is self-contained — no Compose, no bundled Postgres. Every runtime
value comes from env vars:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres 16 connection string. Point at any reachable DB. |
| `AUTH_SECRET` | Auth.js session encryption (`npx auth secret`). |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth web client. The redirect URI to register is `${AUTH_URL}/api/auth/callback/google`. |
| `ALLOWED_EMAILS` | Comma-separated allowlist (PRD C2). Trim + lowercase. |
| `NEXT_PUBLIC_APP_URL` | Public URL of the deployed app. |
| `AUTH_URL` | Auth.js base URL for OAuth callbacks. Must equal `NEXT_PUBLIC_APP_URL` behind a reverse proxy. |

Build, push, run:

```bash
docker build -t jsoladur/monthly-expenses:1.0.0 .
docker push   jsoladur/monthly-expenses:1.0.0

docker run -d --name expenses -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@db.example.com:5432/expenses \
  -e AUTH_SECRET=$(openssl rand -base64 32) \
  -e AUTH_GOOGLE_ID=... \
  -e AUTH_GOOGLE_SECRET=... \
  -e ALLOWED_EMAILS=alice@example.com \
  -e AUTH_URL=https://expenses.example.com \
  -e NEXT_PUBLIC_APP_URL=https://expenses.example.com \
  jsoladur/monthly-expenses:1.0.0
```

The container runs `scripts/migrate.mjs` on every start before the server,
so the schema is always in sync. To run migrations separately (e.g. a
one-shot Job in k8s), override the CMD:

```bash
docker run --rm jsoladur/monthly-expenses:1.0.0 \
  node scripts/migrate.mjs
```

## Tests

```bash
pnpm test           # Vitest: unit + integration (needs Postgres reachable)
pnpm test:e2e       # Playwright: full E2E (needs the dev server)
```

Integration tests skip themselves cleanly when Postgres is unreachable so
`pnpm test` stays usable on a laptop without Docker running.

## Project layout

```
src/
  auth.ts                          Auth.js v5 config (Google + allowlist)
  app/
    [locale]/                      All user-facing routes (UC-01+)
    api/auth/[...nextauth]/        Auth.js handlers
  server/
    auth/                          requireUserId() + allowlist helpers
    db/                            Drizzle schema + client
    repositories/                  userId-first data access
    services/                      Domain logic + transactions
  i18n/                            en/es message bundles
  types/                           next-auth module augmentation
tests/
  unit/                            Vitest unit specs
  integration/                     Vitest + real Postgres specs
  e2e/                             Playwright specs
docs/                              Product + architecture docs (source of truth)
```

See `docs/README.md` for conventions and `docs/IMPLEMENTATION-STATUS.md` for
the live build tracker.
