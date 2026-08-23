import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { signIn } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";

// ============================================================================
// Sign-in screen (UC-01, screen 1; UC-02).
//
// The Google sign-in button submits to the Auth.js `signIn` server action
// (UC-01 / ADR-2). The `signIn` callback runs the `ALLOWED_EMAILS` check
// after Google verifies the account (PRD C2 / C3). Denied users are bounced
// to `/[locale]/403` automatically by Auth.js via `pages.error = '/403'`.
//
// Locale routing lives in the middleware + `[locale]/layout.tsx`; this page
// only calls `setRequestLocale` so server-side `getTranslations()` works.
// ============================================================================

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    // Middleware should have caught this; treat as 404 if it slipped through.
    throw new Error("Unsupported locale segment");
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth.signIn" });

  async function startGoogleSignIn() {
    "use server";
    await signIn("google", { redirectTo: `/${locale}` });
  }

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12"
    >
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("subtitle")}
        </p>
      </header>
      <form action={startGoogleSignIn}>
        <Button type="submit" className="w-full" size="lg">
          {t("googleButton")}
        </Button>
      </form>
    </main>
  );
}
