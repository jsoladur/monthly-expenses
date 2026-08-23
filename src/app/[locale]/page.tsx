import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { Link } from "@/i18n/navigation";
import { requireUserId } from "@/server/auth/require-user-id";
import { getMonthList } from "@/server/services/months";
import { isAppLocale, monthYear, monthName } from "@/i18n/format";
import { routing, type AppLocale } from "@/i18n/routing";
import { MonthCreateForm } from "@/app/[locale]/month-create-form";

// ============================================================================
// Home — UC-06 month list + create (screens 3 / 4 entrypoint).
//
// Flow (PRD UC-14, C6, C12):
//   1. Resolve tenant via `requireUserId(locale)` (the canonical check —
//      ARCH §3.2 rule 4). Unauthenticated callers land on the locale-
//      prefixed sign-in URL.
//   2. If the `last_opened_month` cookie points at a month the user
//      actually owns, redirect straight into that month's workspace.
//   3. Otherwise, render the month list (newest first) + a create-month
//      form. The empty state shows the create form only — nothing is
//      auto-created (PRD C6/C12).
//
// Everything below the heading is a Server Component; the create form is a
// small client island so the server action returns a typed result and the
// form can surface validation / duplicate errors inline.
// ============================================================================

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const t = await getTranslations({ locale, namespace: "auth.signedIn" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  const tm = await getTranslations({ locale, namespace: "months" });
  const tv = await getTranslations({ locale, namespace: "validation" });

  const months = await getMonthList(userId);
  const session = await auth();
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const monthNames = Array.from({ length: 12 }, (_, i) => monthName(locale as AppLocale, i + 1));
  const existingMonths = months.map((m) => ({ year: m.year, month: m.month }));

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col gap-6 px-6 py-12"
    >
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <PwaInstallPrompt />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("subtitle", { email })}
        </p>
        {displayName && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("displayName", { name: displayName })}
          </p>
        )}
      </header>

      {months.length === 0 ? (
        <section
          aria-labelledby="empty-months"
          className="bg-card text-card-foreground flex flex-col gap-3 rounded-md border p-4"
        >
          <h2 id="empty-months" className="text-base font-semibold">
            {tm("empty.title")}
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tm("empty.body")}
          </p>
          <MonthCreateForm
            locale={locale}
            labels={{
              year: tm("create.year"),
              month: tm("create.month"),
              submit: tm("create.submit"),
              duplicate: tm("create.duplicate"),
              validationRequired: tv("required"),
              validationMonth: tv("monthInvalid"),
              validationYear: tv("yearOutOfRange"),
            }}
            monthNames={monthNames}
            existingMonths={existingMonths}
          />
        </section>
      ) : (
        <section aria-labelledby="month-list" className="flex flex-col gap-4">
          <h2 id="month-list" className="text-base font-semibold">
            {tm("list.title")}
          </h2>
          <ul className="flex flex-col gap-2">
            {months.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/months/${m.year}/${m.month}`}
                  className="bg-card text-card-foreground hover:bg-muted/50 flex items-center justify-between rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                >
                  <span>{monthYear(locale as AppLocale, m.year, m.month)}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
          <details className="bg-card text-card-foreground rounded-md border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              {tm("list.createNew")}
            </summary>
            <div className="border-t p-4">
              <MonthCreateForm
                locale={locale}
                labels={{
                  year: tm("create.year"),
                  month: tm("create.month"),
                  submit: tm("create.submit"),
                  duplicate: tm("create.duplicate"),
                  validationRequired: tv("required"),
                  validationMonth: tv("monthInvalid"),
                  validationYear: tv("yearOutOfRange"),
                }}
                monthNames={monthNames}
                existingMonths={existingMonths}
              />
            </div>
          </details>
        </section>
      )}

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
