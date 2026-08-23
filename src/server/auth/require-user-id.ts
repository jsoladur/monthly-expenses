import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

// ============================================================================
// `requireUserId()` — the tenancy primitive (UC-01, ARCH §3.2 rule 4).
//
// Reads the session via `auth()`, returns the internal `app_user.id` for use
// by repositories, and redirects to the locale-prefixed sign-in page when no
// session exists. The redirect path is locale-aware because all app routes
// live under `[locale]` (UC-01 screen 1 / UC-02 i18n shell).
//
// This function is the ONLY way server code learns the current user id.
// Repositories receive it as their first argument so the `user_id` filter is
// never forgotten (PRD §5.1, ARCH §5 rule 1). Session checks live in the
// data-access layer, not only in middleware (ARCH §3.2 rule 4 — middleware
// matcher gaps are a known Auth.js footgun; defense in depth is mandatory).
//
// Wrapped in `React.cache` so multiple server components on the same render
// pass share one session lookup (ARCH §10 performance note).
// ============================================================================

const DEFAULT_LOCALE = "en" as const;
const SIGN_IN_PATH = "/sign-in" as const;

export const requireUserId = cache(async (locale: string = DEFAULT_LOCALE): Promise<string> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (typeof userId !== "string" || userId.length === 0) {
    redirect(buildLocalePath(locale, SIGN_IN_PATH));
  }
  return userId;
});

function buildLocalePath(locale: string, path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${cleanPath}`;
}
