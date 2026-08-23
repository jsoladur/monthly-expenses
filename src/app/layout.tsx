import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { isAppLocale } from "@/i18n/format";
import "./globals.css";

// ============================================================================
// Root layout.
//
// Renders `<html>`/`<body>` because Next.js requires them at the top of the
// `app/` tree. The `lang` attribute is derived from the
// `x-next-intl-locale` request header that next-intl's middleware sets on
// every locale-prefixed URL (`/en/...`, `/es/...`). Falling back to `en`
// keeps build-phase renders (where middleware never runs) and edge cases
// where the header is missing on a non-locale path.
// ============================================================================

export const metadata: Metadata = {
  title: "Monthly Expenses",
  description: "Personal monthly expense tracking.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const headerStore = await headers();
  const headerLocale = headerStore.get("x-next-intl-locale");
  const lang = isAppLocale(headerLocale) ? headerLocale : "en";

  return (
    <html lang={lang} className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
