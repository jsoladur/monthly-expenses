import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";

// ============================================================================
// Forbidden screen (UC-01, screen 2; UC-02).
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
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    throw new Error("Unsupported locale segment");
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth.forbidden" });

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12"
    >
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("body")}
        </p>
      </header>
      <Link
        href="/sign-in"
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        {t("returnHome")}
      </Link>
    </main>
  );
}
