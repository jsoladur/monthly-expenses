import type { ReactNode } from "react";

// ============================================================================
// Locale-scoped layout (UC-01).
//
// All app routes live under `[locale]` so the sign-in and 403 screens can
// render translated copy keyed under `auth.*` (UC-02 extends this with the
// full next-intl routing setup — locale cookie, browser Accept-Language
// fallback, middleware). At UC-01 we only need a stable layout boundary for
// the two screens this slice ships.
// ============================================================================

export default async function LocaleLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
