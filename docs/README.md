# Documentation — Monthly Expenses

> **Audience:** coding agents first, humans second. Read this file BEFORE touching any code.
> **App:** Monthly Expenses PWA (`https://expenses.jmsola.dev`) — Next.js + PostgreSQL, Docker Compose.

## What this folder is

The single source of truth for WHAT to build and HOW to build it. Code that contradicts these documents is a bug — fix the code, not the docs (unless the Product Owner changes a doc).

## File map

| Path | Role | When to read |
| --- | --- | --- |
| `prds/GLOBAL.md` | **PRD — source of truth for BEHAVIOR.** Constraints C1–C18, money rules §7, use cases UC-01…UC-19, test scenarios §15, copy snippets §19. | Before ANY feature work. |
| `architecture/ARCHITECTURE.md` | **Source of truth for TECH.** ADR-1…ADR-10, auth flow §3, data model §4, layering §5, project structure §6, money handling §8, scaffolding §10. | Before ANY feature work. |
| `database/database.dbml` | Physical schema (dbdiagram.io DBML): 9 tables, singular names, PostgreSQL 16. UC-00 migrates everything except `annual`, which arrives with UC-14 (migration 0002). | When writing repositories or migrations. |
| `style/STYLE-GUIDE.md` | **Visual system:** brand palette from the logo, mandated typography, shadcn/Tailwind v4 tokens (light + dark), layout rules (mobile-first, adaptive), component recipes, accessibility, minimalism rules. | Before ANY UI/styling work (every slice with a screen). |
| `usecases/UC-INDEX.md` | **Map of the implementation slices** (see below). | At the start of every work session. |
| `usecases/UC-XX-*.md` | One implementable slice each: server actions, services, routes, i18n keys, acceptance criteria, mapped tests. | When implementing that slice. |
| `IMPLEMENTATION-STATUS.md` | Live tracker of which slices are PENDING / IN_PROGRESS / DONE. | FIRST file to read every session; update it when finishing a slice. |

## Precedence rules

1. Behavior conflict → `prds/GLOBAL.md` (PRD) wins.
2. Tech conflict → `architecture/ARCHITECTURE.md` wins.
3. Visual conflict → `style/STYLE-GUIDE.md` wins.
4. No doc covers it → do NOT invent frameworks, libraries, vendors, behavior, or visual styles. Ask the Product Owner (PRD scope rule, §1).
5. Docs vs code → docs win.

## What UC-INDEX.md means

The PRD is split into 15 implementation slices, `UC-00` … `UC-14`, so the app can be built in steps. `UC-INDEX.md` is the entry point that ties them together:

- **Build order & dependency table** — a slice is implementable ONLY when every slice in its "Depends on" column is DONE in `IMPLEMENTATION-STATUS.md`.
- **Dependency graph** (mermaid) — the same information visually.
- **Global invariants** — rules that apply to EVERY slice (tenancy, money, deletes, i18n, no auto-months).
- **PRD §15 test-scenario map** — which of the 19 normative test scenarios each slice must turn into green tests.
- **Key architectural fact:** UC-00 creates the database in one migration. Slices contain NO schema work — the sole exception is **UC-14**, which adds the `annual` table via migration 0002. UC-14 is a Product Owner decision (2026-08-25) not yet merged into the PRD; until then the UC-14 file is the behavior source of truth for Annuals.

## Standard work loop (agents)

1. Read `IMPLEMENTATION-STATUS.md` → pick the first PENDING slice whose dependencies are all DONE.
2. Read the slice file, then the PRD and architecture sections it references. If the slice renders UI, also read `style/STYLE-GUIDE.md`.
3. TDD: translate the slice's mapped PRD §15 scenarios into Vitest/Playwright specs FIRST (ARCH §10).
4. Implement following the layering in ARCH §5: RSC for reads, thin server actions (Zod → service → revalidate), services own domain rules and transactions, repositories own SQL and take `userId` first.
5. **Definition of done:** typecheck + lint clean · the slice's PRD §15 scenarios green · no `userId`-less repository call exists.
6. Mark the slice DONE in `IMPLEMENTATION-STATUS.md` (ISO date + notes).
7. Add a `CHANGELOG.md` entry under `[Unreleased]` in the same commit (rules in `AGENTS.md`).

## Global invariants (never violate)

- **Tenancy:** every query/mutation filters by the session `user_id`. A missing filter is a P0 bug (PRD §5.1).
- **Money:** `numeric(14,2)` in DB, integer cents in domain code, `"1234.56"` strings on the wire. Never floats (ADR-5).
- **Deletes:** soft for catalogs (`category`, `template`, `annual`); hard for month-scoped money rows (PRD §13).
- **i18n:** every user-facing string keyed, `en`/`es`; month names from locale; amount input always dot-decimal (PRD §11).
- **Months:** never auto-created; cloned once from active templates at creation; fully independent afterwards (PRD C6/C17/§7.8).
- **Schema:** table names are singular; the users table is `app_user` because `user` is reserved in PostgreSQL. Only UC-14 adds a table (`annual`).
- **Styling:** all UI follows `style/STYLE-GUIDE.md` — no colors, fonts, or radii outside its tokens.
