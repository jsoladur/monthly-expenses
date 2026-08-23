import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// ============================================================================
// Bare `/` — belt-and-suspenders redirect to the default locale.
//
// The middleware in `src/middleware.ts` already rewrites `/` to `/<locale>`
// for any browser request; this page is the fallback for any path that
// bypasses the middleware (e.g. an internal fetch).
// ============================================================================

export default function RootPage() {
  redirect({ href: "/", locale: routing.defaultLocale });
}
