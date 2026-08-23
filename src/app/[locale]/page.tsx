import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

// ============================================================================
// Home — UC-01 minimal stub (signed-in landing).
//
// For now the home only confirms the sign-in flow is observable end to end:
// it greets the signed-in user by email and offers sign-out. The real month
// workspace (current month + month list + dashboard) ships in UC-06.
//
// Locale routing is handled by the middleware + `[locale]/layout.tsx`; this
// page just calls `setRequestLocale` and validates the segment.
// ============================================================================

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect({ href: "/sign-in", locale });
  }
  // `redirect` returns `never` but TS still widens `session` back to nullable
  // after the explicit guard when called via the next-intl wrapper. Narrow
  // explicitly: if we got here, `session.user.id` is a non-empty string and
  // `session.user` is a defined object.
  const { user } = session!;

  const t = await getTranslations({ locale, namespace: "auth.signedIn" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const email = user.email ?? "";
  const displayName = user.name ?? null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

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
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("subtitle", { email })}
        </p>
      </header>
      {displayName && (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("displayName", { name: displayName })}
        </p>
      )}
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t("comingNext")}
      </p>
      <nav className="flex flex-col gap-2">
        <Link
          href="/templates"
          className="bg-card text-foreground hover:bg-muted/50 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
        >
          {tn("templates")}
        </Link>
        <Link
          href="/categories"
          className="bg-card text-foreground hover:bg-muted/50 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
        >
          {tn("categories")}
        </Link>
        <Link
          href="/settings"
          className="bg-card text-foreground hover:bg-muted/50 rounded-md border px-4 py-2 text-sm font-medium transition-colors"
        >
          {tn("settings")}
        </Link>
      </nav>
      <form action={startSignOut}>
        <Button type="submit" variant="outline" className="w-full" size="lg">
          {t("signOut")}
        </Button>
      </form>
    </main>
  );
}
