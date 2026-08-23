# UC-04 — Profile settings (currency)

> **Database:** already migrated (UC-00). Uses `profile_settings` (row created at first login in UC-01). No schema changes.
> **PRD refs:** UC-15; C9; §5.3. Screen 8 (PRD §10).
> **ARCH refs:** §5 (layering), §8 (money formatting).

## Goal

A settings screen where the user picks their currency label. Currency is display-only: every amount renders with 2 decimals and the label; there is NO FX conversion (PRD UC-15, C9).

## Server actions (`src/actions/settings.ts`)

- `updateCurrency({ currency })` — ISO 4217 alpha-3 code (e.g. `EUR`, `USD`); stored in `profile_settings.currency` (`char(3)`).

## Service / repository

- `getProfileSettings(userId)` — used app-wide to label amounts.
- Formatting helper: `formatMoney(cents, currency)` → `"1234.56"` + label; always 2 decimals; amounts may be negative (PRD §7.6).

## Routes / UI

- `[locale]/settings` — currency selector (screen 8).

## i18n keys

- `settings.*`

## Acceptance criteria

- Default is EUR (row provisioned in UC-01).
- Changing currency updates the label everywhere; stored amounts are untouched (no conversion).
- All amounts render with exactly 2 decimals in both locales.

## Depends on

- UC-01 (profile_settings row exists), UC-02.
