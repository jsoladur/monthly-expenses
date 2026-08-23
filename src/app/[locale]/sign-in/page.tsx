import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  loadMessages,
} from "@/i18n/load-messages";

// ============================================================================
// Sign-in screen (UC-01, screen 1).
//
// The Google sign-in button submits to the Auth.js `signIn` server action
// (UC-01 / ADR-2). The `signIn` callback runs the `ALLOWED_EMAILS` check
// after Google verifies the account (PRD C2 / C3). Denied users are bounced
// to `/[locale]/403` automatically by Auth.js via `pages.error = '/403'`.
// ============================================================================

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const messages = loadMessages(locale);

  async function startGoogleSignIn() {
    "use server";
    await signIn("google", { redirectTo: `/${locale}` });
  }

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {messages.auth.signIn.title}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {messages.auth.signIn.subtitle}
        </p>
      </header>
      <form action={startGoogleSignIn}>
        <Button type="submit" className="w-full" size="lg">
          {messages.auth.signIn.googleButton}
        </Button>
      </form>
    </main>
  );
}
