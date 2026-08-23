# Implementation status — Monthly Expenses

> **Live tracker.** The coding agent updates this file at the end of every work session on a use case (see `AGENTS.md` §4).
> **Status values:** `PENDING` → `IN_PROGRESS` → `DONE`. Exactly one row per use-case file in `usecases/`.

## Rules for updating (agents)

- Set `IN_PROGRESS` when you start a slice. Only ONE slice may be `IN_PROGRESS` at a time.
- Set `DONE` only when the definition of done passes: typecheck + lint clean · the slice's mapped PRD §15 test scenarios are green · no `userId`-less repository call exists (ARCH §10).
- Fill **Completed** with an ISO date (`YYYY-MM-DD`) and **Notes** with anything the next agent must know (deviations, follow-ups, caveats). Leave empty otherwise.
- A `CHANGELOG.md` entry under `[Unreleased]` is MANDATORY in the same commit as the `DONE` flip.
- Never edit a `DONE` row except to fix a factual error. Regressions are handled as new work and a `Fixed` entry in the changelog.
- A slice may only be started when every slice in its "Depends on" column (`usecases/UC-INDEX.md`) is `DONE`.

## Progress

- Slices DONE: **2 / 13**
- Next up: **UC-02 — i18n shell (en/es)**

## Status table

| Slice | Title | Status | Completed | Notes |
| --- | --- | --- | --- | --- |
| UC-00 | Foundations & database bootstrap | DONE | 2026-08-23 | Drizzle schema, first migration, money helpers, Zod amount schema, Vitest (unit + integration), Playwright config, multi-stage Dockerfile + docker-compose (app + postgres on `expenses-net`), full ARCH §10 scaffolding (src/app layout, shadcn init with base-nova, next-auth@beta, next-intl, Serwist `manifest.ts` + `sw.ts`). Build runs with `--webpack` so the Serwist plugin works (Next 16 Turbopack is opt-in). |
| UC-01 | Google sign-in, allowlist & tenancy | DONE | 2026-08-23 | Auth.js v5 with Google provider + `ALLOWED_EMAILS` allowlist (`signIn` callback normalizes trim + lowercase), JWT session carrying the internal `app_user.id` (`jwt` resolves it by `google_sub`, `session` exposes it via the `next-auth` module augmentation in `src/types/next-auth.d.ts`). New `app_user` + `profile_settings(currency='EUR')` created in one transaction via the `upsertUserOnSignIn` service. `requireUserId()` lives in the data-access layer (`src/server/auth/require-user-id.ts`), wrapped in `React.cache`. Sign-in (`/[locale]/sign-in`) and 403 (`/[locale]/403`) pages render `auth.signIn.*` / `auth.forbidden.*` copy from `src/i18n/messages/{en,es}.json`; UC-02 will replace the minimal `loadMessages` helper with the full next-intl `defineRouting` + middleware setup. Denied users land on `/[locale]/403` via `pages.error = '/403'`. PRD scenarios #1 (allowlist hit/miss) + #2 (two users isolated) covered by `tests/unit/allowlist.test.ts` and `tests/integration/auth.test.ts`. Added `server-only` dep + Vitest alias stub so RSC markers resolve cleanly in Node test runs. |
| UC-02 | i18n shell (en/es) | PENDING | | |
| UC-03 | Categories (expense & income) | PENDING | | |
| UC-04 | Profile settings (currency) | PENDING | | |
| UC-05 | Fixed/estimated templates | PENDING | | |
| UC-06 | Month creation, cloning & home | PENDING | | |
| UC-07 | Month incomes | PENDING | | |
| UC-08 | Actual expenses | PENDING | | |
| UC-09 | Reserved lines (remaining, month-only) | PENDING | | |
| UC-10 | Pass to actual & undo | PENDING | | |
| UC-11 | Summary, savings & warnings | PENDING | | |
| UC-12 | PWA install | PENDING | | |
