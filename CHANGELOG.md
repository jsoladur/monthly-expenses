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
