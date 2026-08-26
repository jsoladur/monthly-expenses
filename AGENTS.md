<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Everything BELOW this line is project-owned. The block above is managed by
     `next dev` (Next.js 16.3+): do not edit inside its markers; it is upserted
     automatically and content outside the markers is preserved. -->

# AGENTS.md — Monthly Expenses

> Conventions for coding agents working in this repository. Read `docs/README.md` first — it explains the documentation layout, precedence rules, and the standard work loop.

## 1. Sources of truth

- `docs/prds/GLOBAL.md` — behavior (PRD). Constraints C1–C18 and money rules §7 are normative.
- `docs/architecture/ARCHITECTURE.md` — tech. ADR-1…ADR-10 are binding; do not deviate without asking the Product Owner (ARCH §10).
- `docs/usecases/UC-INDEX.md` + `docs/IMPLEMENTATION-STATUS.md` — the work plan and its live state.
- Conflicts: the PRD wins for behavior, the architecture wins for tech. Gaps: ask — never invent libraries, vendors, or behavior.
- Next.js APIs and conventions: trust the bundled docs in `node_modules/next/dist/docs/` (see the managed block above), not training data.

## 2. Non-negotiable technical rules

- **Tenancy (P0):** every repository function takes `userId` as its first argument and applies it in every `WHERE`. A missing `user_id` filter is a P0 bug (PRD §5.1). Session checks live in the data-access layer via `requireUserId()`, not only in middleware (ARCH §3.2).
- **Money:** `numeric(14,2)` in the DB, integer cents in domain code, strings matching `^-?\d{1,12}\.\d{2}$` on the wire. Never `float`/`number` arithmetic on amounts (ADR-5, ARCH §8).
- **Layering (ARCH §5):** reads in React Server Components; mutations as thin server actions (Zod parse → service call → revalidate); services own ALL domain rules and transactions (`cloneMonth`, `passToActual`, `undoPassToActual`, summaries); repositories are the only place SQL lives.
- **Deletes (PRD §13):** soft delete for catalogs (`category`, `template`); hard delete for month-scoped money rows (`month_income`, `month_fixed_line`, `month_actual_expense`).
- **Months:** never auto-created; templates cloned ONCE at creation; months never sync with templates or each other afterwards; no rollover (PRD C6/C7/C17/§7.8).
- **i18n:** every user-facing string keyed (`en`/`es`); month names from locale; amount input stays dot-decimal in both locales (PRD §11).
- **Schema:** the entire database is created in UC-00's single migration. Later slices NEVER add tables or columns. Table names are singular; the users table is `app_user` (`user` is reserved in PostgreSQL).

## 3. Workflow per use case

1. Open `docs/IMPLEMENTATION-STATUS.md` → pick the first `PENDING` slice whose dependencies (per `docs/usecases/UC-INDEX.md`) are all `DONE`. Flip it to `IN_PROGRESS`.
2. Read the slice file in `docs/usecases/`, then the PRD and architecture sections it references.
3. TDD: translate the slice's mapped PRD §15 test scenarios into Vitest/Playwright specs BEFORE implementing (ARCH §10).
4. Implement per the layering rules above.
5. **Definition of done:** typecheck + lint clean · the slice's PRD §15 scenarios green · no `userId`-less repository call.
6. Flip the slice to `DONE` in `docs/IMPLEMENTATION-STATUS.md` with the ISO date and notes (see §4).
7. Add a `CHANGELOG.md` entry under `[Unreleased]` in the SAME commit (see §5).

## 4. Implementation-status tracking (mandatory)

`docs/IMPLEMENTATION-STATUS.md` is the live tracker of implemented use cases.

- Update it EVERY time a use case is finished — the `DONE` flip, the completion date (`YYYY-MM-DD`), and any notes for the next agent.
- Also update the **Progress** line (slices DONE counter + next-up slice).
- Only one slice `IN_PROGRESS` at a time; if work is abandoned, flip it back to `PENDING` with a note explaining why.
- The `DONE` flip and its changelog entry land in the same commit as the implementation.
- Never rewrite a `DONE` row except to correct a factual error.

## 5. Changelog (mandatory)

`CHANGELOG.md` at the repo root follows [Keep a Changelog 1.0.0](https://keepachangelog.com/en/1.0.0/) exactly.

- Keep the header (title, "All notable changes…", the Keep a Changelog + Semantic Versioning lines) intact forever.
- `[Unreleased]` is always the top section. Add every notable change there.
- Group entries under these types, omitting empty ones: `Added` (new features), `Changed` (changes in existing functionality), `Deprecated`, `Removed`, `Fixed` (bug fixes), `Security`.
- One bullet per notable change, written for humans, referencing the use-case id — e.g. `- Month creation with one-time clone of active templates (UC-06).`
- Every `DONE` flip in `docs/IMPLEMENTATION-STATUS.md` requires at least one entry in the same commit. Fixes and changes between slices also get entries.
- Do NOT dump git logs into the changelog — curate entries that describe the noteworthy difference, not each commit.
- **Releases:** only the Product Owner cuts a release. When asked, move the `[Unreleased]` entries under a new `## [x.y.z] - YYYY-MM-DD` heading (Semantic Versioning, ISO 8601 date), newest version first, and leave an empty `[Unreleased]` on top. Never create a version section on your own.
