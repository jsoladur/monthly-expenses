# UC-12 — PWA install

> **Database:** not touched.
> **PRD refs:** UC-04; C11 (online-only, install still required); §12. Screen 10 (PRD §10).
> **ARCH refs:** ADR-7 (Serwist); §7 (PWA rules).

## Goal

Make the app installable on a smartphone with a permanent install affordance when the browser reports not-installed. Data stays online-only — installability, not offline sync (PRD C11).

## Work

- Wire Serwist (`@serwist/next`): service worker generated at build; precache the app shell ONLY; NO runtime caching of API/data responses (ARCH §7).
- `src/app/manifest.ts`: name, `start_url` = `https://expenses.jmsola.dev`, `display: 'standalone'`, icons 192 / 512 / maskable in `public/icons/`.
- Install affordance component: visible whenever the browser reports the app is not installed; hidden once installed (PRD UC-04). Keyed copy in both locales.

## i18n keys

- `pwa.install.*`

## Acceptance criteria

- Installable from Android Chrome / iOS Safari (Add to Home Screen).
- Lighthouse PWA installability checks pass.
- App shell loads from precache; all data requests still hit the network (online-only, PRD C11).

## Depends on

- UC-00 only — slot this in whenever convenient; recommended last so the shell precaches the final routes.
