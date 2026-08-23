import { createNavigation } from "next-intl/navigation";
import { routing } from "@/i18n/routing";

// ============================================================================
// Locale-aware navigation primitives (UC-02, ADR-8).
//
// Re-exports next-intl's typed `<Link>`, `redirect`, `usePathname`,
// `useRouter`, and `getPathname` so every component imports the
// locale-aware versions. Using the raw `next/link` or `next/navigation`
// helpers would skip the `[locale]` prefix and break locale routing.
// ============================================================================

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
