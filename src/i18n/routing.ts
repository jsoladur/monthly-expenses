import { defineRouting } from "next-intl/routing";

// ============================================================================
// Locale routing — single source of truth (UC-02, ARCH §7, ADR-8).
//
// Locales: `en` (default) and `es`. PRD C4 + UC-03 require browser locale
// fallback to `en` for anything outside this set (`fr`, `de`, etc.).
//
// `localePrefix: 'always'`:
//   Every app route is rendered under `/<locale>/...`. The middleware adds
//   the prefix on requests that arrive without one, choosing via cookie →
//   Accept-Language → default. Keeping the prefix always-on makes every
//   shared URL self-describing and avoids the cookie dance that `'as-needed'`
//   triggers on first visit.
//
// `localeCookie` is what makes the language switcher persistent
// (PRD §5.4, §11): once set by a click, future reloads resolve to the
// same locale without consulting `Accept-Language` again.
// ============================================================================

export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
  },
});

export type AppLocale = (typeof routing.locales)[number];
