import type { ReactNode } from "react";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale, getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

// ============================================================================
// Locale-scoped layout (UC-02, ARCH §7).
//
// All app routes live under `[locale]`. This layout:
//   1. Validates the segment against the supported locales — invalid locales
//      404 instead of silently rendering the default (defense in depth; the
//      middleware already redirected unknowns).
//   2. Calls `setRequestLocale` so the static-renderable server components
//      downstream can call `getTranslations()` / `useTranslations()`.
//   3. Wraps children in `<NextIntlClientProvider>` so client components
//      (the language switcher, `AmountInput`) can call `useTranslations()`
//      without prop-drilling the messages.
//
// UC-01 screens (sign-in, 403) and the UC-01 signed-in landing render
// here; later slices add the month workspace and chrome.
// ============================================================================

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
