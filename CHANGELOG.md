# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Product requirements document `docs/prds/GLOBAL.md` — MVP money rules, constraints C1–C18, use cases UC-01…UC-19, and normative test scenarios.
- Architecture document `docs/architecture/ARCHITECTURE.md` — ADR-1…ADR-10 (Next.js BFF, Auth.js v5 with Google + allowlist, Drizzle ORM, Serwist PWA, next-intl, Vitest + Playwright).
- Database schema proposal `docs/database/database.dbml` — 8 tables with singular names, 3 enums, PostgreSQL 16, dbdiagram.io DBML.
- Use-case breakdown `docs/usecases/` — 13 implementation slices (UC-00…UC-12) plus `UC-INDEX.md` with build order, dependencies, and PRD test-scenario mapping.
- Agent-facing documentation guide `docs/README.md` and live implementation tracker `docs/IMPLEMENTATION-STATUS.md`.
- Agent conventions in `AGENTS.md`, including mandatory implementation-status tracking and changelog rules.
- Foundations & database bootstrap (UC-00): Drizzle ORM + `postgres-js` client, full schema (`src/server/db/schema.ts`) materialising the 8 tables and 3 enums of `database.dbml`, first migration with the partial unique index on `category(name) WHERE active` and the `month_range_ck` check constraint, integer-cents money helpers (`src/server/money.ts`), shared Zod amount schema (`src/server/validators.ts`), Vitest unit + integration suites, Playwright config, multi-stage `Dockerfile` (node:22-alpine, Next.js `standalone` output, runtime migration entrypoint) and `docker-compose.yml` wiring `app` + `postgres:16-alpine` on the `expenses-net` bridge network with a healthcheck-gated `depends_on`.
- UC-00 follow-up: completed the remaining ARCH §10 scaffolding steps — `app/` moved to `src/app/`, `shadcn init` (base-nova preset, neutral palette, lucide icons, `src/components` + `src/lib`), `next-auth@beta` and `next-intl` dependencies installed, Serwist wired (`src/app/sw.ts` + `src/app/manifest.ts` with precache-only app shell, no runtime data caching per PRD C11). Build uses `next build --webpack` (and dev uses `next dev --webpack`) because `@serwist/next` is webpack-based; Next 16 Turbopack is opt-in for the rest of the toolchain.
