import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "@/i18n/routing";

// ============================================================================
// next-intl request configuration (UC-02, ADR-8).
//
// Resolves the locale from the `[locale]` segment set by the middleware, then
// loads the matching message bundle. Falls back to the default locale for any
// route that bypassed the middleware (defense in depth — the matcher in
// `src/middleware.ts` already redirects unknown prefixes).
//
// `setRequestLocale` is called from every layout / page under `[locale]/`
// before any `getTranslations()` / `useTranslations()` call. That single
// declaration is what makes next-intl static-renderable even with
// server-side `t()` calls.
// ============================================================================

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`@/i18n/messages/${locale}.json`)).default,
  };
});
