import { redirect } from "next/navigation";
import { DEFAULT_LOCALE } from "@/i18n/load-messages";

// ============================================================================
// Bare `/` — redirects to the default locale (UC-01, UC-02).
//
// The locale prefix is required because every app route lives under
// `[locale]`. UC-02 replaces this with the full next-intl middleware that
// resolves locale from the cookie and `Accept-Language` header.
// ============================================================================

export default function RootPage() {
  redirect(`/${DEFAULT_LOCALE}`);
}
