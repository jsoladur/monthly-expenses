import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// ============================================================================
// Edge middleware (UC-02, ADR-8, ARCH §7).
//
// Locale negotiation order (PRD C4):
//   1. Cookie (`NEXT_LOCALE`, set by the language switcher)
//   2. Browser `Accept-Language` header — only `en` / `es` honored
//   3. `routing.defaultLocale` (`en`)
//
// The matcher below intentionally excludes:
//   - `/api/*`               — Auth.js callbacks must not be locale-rewritten
//   - `/_next/*`             — Next.js internals
//   - `/_vercel/*`           — Vercel platform internals
//   - any path containing a dot (static assets like `sw.js`, `manifest.webmanifest`)
//
// Auth.js itself is the *only* authority for session checks. This middleware
// just adds the locale prefix; it does NOT gate access. `requireUserId()` in
// the data-access layer remains the canonical tenancy check (ARCH §3.2
// rule 4: "session checks live in the data-access layer, not only in
// middleware").
// ============================================================================

export default createMiddleware(routing);

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
