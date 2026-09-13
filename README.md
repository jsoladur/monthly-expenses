<p align="center">
  <a href="https://github.com/jsoladur/monthly-expenses/actions"><img alt="Build Status" src="https://github.com/jsoladur/monthly-expenses/actions/workflows/main.yml/badge.svg"></a>
  <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/"><img alt="License: CC BY-NC-SA 4.0" src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg"></a>
  <br>
  <a href="https://nodejs.org/"><img alt="Node.js Version" src="https://img.shields.io/badge/node-22%2B-339933.svg"></a>
  <a href="https://nextjs.org/"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black.svg"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6.svg"></a>
  <a href="https://pnpm.io/"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-F69220.svg"></a>
  <a href="https://eslint.org/"><img alt="ESLint" src="https://img.shields.io/badge/eslint-9-4B32C3.svg"></a>
</p>

# Monthly Expenses

A personal, multi-tenant Progressive Web App for tracking **one calendar month at a time**: incomes, reusable categories, fixed commitments, estimated envelopes, and actual tickets. From the day a month is created, reserved money is already in place so **potential savings** is visible immediately.

Product, architecture, and implementation docs live in [`docs/README.md`](docs/README.md).

---

## How this was built

This repository is a **vibe-coding** experiment.

Almost all of the application — code, tests, and documentation — was written in [Cursor](https://cursor.com) with **Cursor Pro**, using the **Cursor Grok 4.6** model as the coding agent. A human set the non-negotiables (the [PRD](docs/prds/GLOBAL.md), [architecture ADRs](docs/architecture/ARCHITECTURE.md), integer-cents money rules, and per-user tenancy) and steered the work. The model implemented against those specs.

The goal was to see how far a tightly constrained personal product can be taken by pairing a software engineer with an agent, not to hide that an LLM wrote large parts of the tree.

---

## ⚠️ Disclaimer

> **This app is a personal bookkeeping tool, not financial advice.**
> You are responsible for your own numbers, backups, hosting, and Google OAuth setup. The author is not responsible for data loss, misconfigured deployments, or decisions you make from the totals on screen.

---

## Features

### Month workspace
- **Manual months only** — you pick year + month; nothing is auto-created or rolled over.
- **Incomes, actuals, committed, estimated** — one workspace per month, with potential savings = incomes − (actuals + remaining reserved).
- **Pass to actual** — cut-paste a committed line into actuals (undo while the ticket is untouched).
- **Pass to upcoming month** — move an estimated leftover onto a later month of the same year that already exists.
- **Past months stay editable**, with a warning.

### Catalogs
- Per-user **expense and income categories** (soft delete; historical rows keep their label).
- **Fixed and estimated templates**, cloned **once** when a month is created; months never sync with templates afterwards.
- **Annuals** — yearly reminders in the matching calendar month; they never create money rows.

### Insights and export
- **Global Stats** — multi-year household charts (Recharts).
- **Search** — find actual tickets across years by name or notes.
- **Excel export** — download created months as a multi-sheet `.xlsx` (all / years / specific months). Totals and summary cells are Excel formulas with the profile currency format.

### Access and i18n
- **Google sign-in** plus a hardcoded email allowlist (`ALLOWED_EMAILS`).
- **English and Spanish**; month names from the locale; amount input stays `1234.56` in both.
- **Installable PWA** (online-only; no offline sync).
- **Multi-tenant isolation** — every query is scoped by `user_id`.

---

## Architecture Overview

One Next.js app is the UI and the backend (BFF). PostgreSQL is the only datastore. Google is the only identity provider.

```mermaid
flowchart LR
    subgraph Client["User device"]
        PWA["Installed PWA / Browser<br/>(online only)"]
    end

    subgraph Server["Host"]
        APP["Next.js app<br/>RSC + server actions + Auth.js"]
        DB[("PostgreSQL 16<br/>user-scoped rows")]
        APP -->|"SQL (Drizzle)"| DB
    end

    GOOGLE["Google Accounts<br/>(OIDC)"]

    PWA -->|"HTTPS + httpOnly session cookie"| APP
    APP -->|"OIDC code exchange (server-side)"| GOOGLE
```

Layering: React Server Components for reads; thin server actions (Zod → service → revalidate); services own domain rules and transactions; repositories are the only place SQL lives, and every function takes `userId` first.

```mermaid
flowchart TD
    RSC["Server Components (reads)"] --> SVC
    ACT["Server Actions"] --> ZOD["Zod"]
    ZOD --> SVC["Services — domain rules"]
    SVC --> REPO["Repositories (Drizzle, userId first)"]
    REPO --> DB[("PostgreSQL")]
```

Stack: Next.js 16 (App Router) · Auth.js v5 · PostgreSQL 16 · Drizzle · Tailwind + shadcn/ui · next-intl · Serwist · ExcelJS · Vitest + Playwright.

---

## Installation

### Prerequisites
- Node.js 22+ (Docker image uses `22.15.0`)
- [pnpm](https://pnpm.io) 11.22.0 (`packageManager` in `package.json`)
- PostgreSQL 16 (or Docker, for the bundled `db` service)
- A Google OAuth **web** client

### Clone the repository
```sh
git clone https://github.com/jsoladur/monthly-expenses.git
cd monthly-expenses
```

### Install dependencies
```sh
pnpm install
```

### Environment setup
```sh
cp .env.example .env
```

Fill in at least `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `ALLOWED_EMAILS`. For `pnpm dev` on the host, point `DATABASE_URL` at localhost (the example hostname `db` is for Compose-internal networking).

---

## Usage

### Local development
Start Postgres (Compose currently ships the `db` service; the `app` service is commented out so the Next.js process runs on the host):

```sh
docker compose up -d db
pnpm dev
```

`pnpm dev` runs Drizzle migrations, then Next.js on [http://localhost:3000](http://localhost:3000).

Google redirect URI to register: `http://localhost:3000/api/auth/callback/google`.

### Tests and checks
```sh
pnpm test:unit      # Vitest unit specs (no database)
pnpm test           # unit + integration (integration skips if Postgres is unreachable)
pnpm test:e2e       # Playwright (needs the app running)
pnpm typecheck
pnpm lint
```

### Docker image
The image is self-contained — no Compose, no bundled Postgres. It runs `scripts/migrate.mjs` on every start.

```sh
docker build -t jsoladur/monthly-expenses:0.7.0 .
docker run -d --name expenses -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@db.example.com:5432/expenses \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_GOOGLE_ID=... \
  -e AUTH_GOOGLE_SECRET=... \
  -e ALLOWED_EMAILS=you@example.com \
  -e AUTH_URL=https://expenses.example.com \
  -e NEXT_PUBLIC_APP_URL=https://expenses.example.com \
  jsoladur/monthly-expenses:0.7.0
```

To run migrations only:

```sh
docker run --rm jsoladur/monthly-expenses:0.7.0 node scripts/migrate.mjs
```

---

## Configuration

Configuration is environment variables. See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres 16 connection string |
| `AUTH_SECRET` | Auth.js session encryption (`npx auth secret`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth web client |
| `ALLOWED_EMAILS` | Comma-separated allowlist (trim + lowercase) |
| `NEXT_PUBLIC_APP_URL` | Public URL of the app |
| `AUTH_URL` | Auth.js base URL; must match `NEXT_PUBLIC_APP_URL` behind a reverse proxy |
| `POSTGRES_DB` / `POSTGRES_USER` / `DB_PASSWORD` | Local Compose `db` service only |

OAuth callback: `${AUTH_URL}/api/auth/callback/google`.

---

## Contributing

Contributions are welcome if they stay under the same license: **free, public source, not for sale.**

The working contract for this repo is in [`docs/README.md`](docs/README.md) and [`AGENTS.md`](AGENTS.md). Behavior comes from the PRD; tech comes from the architecture doc; do not invent libraries or product rules.

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/your-change`).
3. Follow the slice conventions (tenancy, integer cents, i18n keys, changelog).
4. Open a Pull Request.

---

## License

Copyright jmsola.dev ©️ 2026.

This project is **free to use, fork, and improve**. It is **not** for sale.

Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). In plain terms:

- You **may** run it, study it, modify it, contribute, and fork it.
- You **may not** sell this product or a modified version of it.
- If you share a fork or improvement, it **must stay free** under CC BY-NC-SA 4.0 (ShareAlike).

See [`LICENSE`](LICENSE) for the full text.
