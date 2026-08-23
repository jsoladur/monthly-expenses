import Link from "next/link";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  loadMessages,
} from "@/i18n/load-messages";

// ============================================================================
// Forbidden screen (UC-01, screen 2).
//
// Lands here:
//   • The Auth.js `signIn` callback returning `false` for a non-allowlisted
//     Google account (PRD C3, ARCH §3.2 rule 1).
//   • Any other auth error redirected via `pages.error = '/403'` in
//     `src/auth.ts`.
//
// Copy follows PRD §19: "This account is not allowed to use the app."
// No database row was ever created for the denied user (PRD C3,
// ARCH §3.2 rule 2).
// ============================================================================

export default async function ForbiddenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const messages = loadMessages(locale);

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {messages.auth.forbidden.title}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {messages.auth.forbidden.body}
        </p>
      </header>
      <Link
        href={`/${locale}/sign-in`}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        {messages.auth.forbidden.returnHome}
      </Link>
    </main>
  );
}
