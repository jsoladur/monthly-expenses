# UC-01 — Google sign-in, allowlist & tenancy

> **Database:** already migrated (UC-00). Uses `app_user`, `profile_settings`. No schema changes.
> **PRD refs:** UC-01, UC-02, UC-17; C1, C2, C3; §3 (actors), §5.1–5.2.
> **ARCH refs:** §3 (sign-in flow + rules 1–5), ADR-2 (Auth.js v5, Google only), ADR-3 (JWT session, no adapter).

## Goal

Only allowlisted Google users get a session and tenant rows; everyone else lands on 403 with nothing created. This slice also delivers `requireUserId()`, the tenancy primitive every later slice depends on.

## Server-side work

- `src/auth.ts` — Auth.js v5 with the Google provider only:
  - `signIn` callback: normalize email (trim, lowercase) and check against `ALLOWED_EMAILS` (comma-separated env var). Deny → `return false` → user lands on `/403` (PRD C3; ARCH §3.2 rule 1).
  - On allow: upsert `app_user` by `google_sub`; on first insert, also insert `profile_settings(currency='EUR')` in the same transaction (PRD UC-01).
  - `jwt` callback: `token.userId = app_user.id`; `session` callback exposes it. Server code never trusts client-supplied user ids (ARCH §3.2 rule 3).
  - `pages.error = '/403'`.
- `requireUserId()` in the data-access layer: reads the session via `auth()`, throws/redirects when absent. Session checks live here, not only in middleware (ARCH §3.2 rule 4).
- Repository rule enforced from this slice on: every function takes `userId` first and applies it in every `WHERE` (PRD §5.1 — missing filter = P0 bug).

## Routes / screens

- `[locale]/sign-in` — Google sign-in button (screen 1).
- `[locale]/403` — i18n page, copy per PRD §19: "This account is not allowed to use the app." (screen 2).

## i18n keys

- `auth.signIn.*`, `auth.forbidden.*`

## Acceptance criteria

- Allowlisted email → httpOnly JWT session cookie; `app_user` + `profile_settings` rows exist; currency is EUR.
- Non-allowlisted Google account → 403 page, NO session, NO database rows (PRD C3; ARCH §3.2 rule 2).
- Blocked user added later to `ALLOWED_EMAILS` → can sign in after env change/restart.
- Two users in parallel: seeded integration data for user B is never returned by user A's repository calls (PRD UC-17).

## Tests (PRD §15)

- #1 Allowlist hit/miss → 403, no data leak.
- #2 Two users fully isolated (repository-level integration test).

## Depends on / unlocks

- Depends on: UC-00.
- Unlocks: all authenticated slices (everything except UC-02, UC-12).
