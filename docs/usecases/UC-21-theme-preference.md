# UC-21 — Theme preference (auto / light / dark)

> **Status:** **DONE — shipped 2026-08-23** (commit `101784d`). Retroactive slice written 2026-11-03 so the feature has a slice file; it documents existing behavior and asks for no new work.
> **Database:** **added** enum `theme_preference` (`auto` | `light` | `dark`) and column `profile_settings.theme theme_preference NOT NULL DEFAULT 'auto'` (migration `0001_wakeful_sebastian_shaw.sql`). Product Owner decision (post-MVP enhancement, schema exception).
> **PRD refs:** none (not in PRD v1). Extends §5.3 profile settings and screen 8 (PRD §10). **This file is the behavior source of truth.**
> **ARCH refs:** §5 (layering), STYLE-GUIDE light + dark tokens.

## Goal

The user picks how the app looks: **Auto** (follow the device), **Light** or **Dark**. The choice is stored per user and applied without a flash of the wrong theme.

## Data model

- `profile_settings.theme`, default `auto`. Inserted with the profile row at first sign-in (UC-01), alongside `currency`.

## Service / repository

- Repository `src/server/repositories/profile-settings.ts`: `updateTheme(userId, theme, tx)`.
- Service `src/server/services/settings.ts`: `updateTheme(userId, theme)` validates against `auto | light | dark` (`InvalidThemeError`, code `invalid_theme`).

## Server action

- `updateThemeAction({ theme })` in `src/actions/settings.ts`: Zod `z.enum(["auto", "light", "dark"])` → service → revalidate.

## UI

- Settings page (`/[locale]/settings`): theme selector next to currency.
- `src/components/theme-provider.tsx` (client) wraps the app. It reads the user preference, resolves `auto` with the `prefers-color-scheme` media query (and follows live changes), toggles the `dark` class on `<html>` and persists the resolved theme to a cookie.
- `src/lib/theme-init-script.ts`: an inline script in the root layout applies the theme before first paint (no flash).

## i18n keys

- `settings.{theme, themeHelp, themeOptions.*}`, `settings.*.themeSaved`

## Acceptance criteria (as shipped)

- Default for a new user is Auto; Auto follows the device setting and its live changes.
- Choosing Light or Dark persists across sessions and devices (stored on the profile, not only in the cookie).
- No flash of the wrong theme on load.
- An invalid value is rejected (`InvalidThemeError`); a user only changes their own profile row.

## Depends on / unlocks

- Depends on: UC-01, UC-04.
- Unlocks: —
