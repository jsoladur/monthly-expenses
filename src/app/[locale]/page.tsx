import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { requireUserId } from "@/server/auth/require-user-id";
import { getMonthList } from "@/server/services/months";
import { isAppLocale, monthYear, monthName } from "@/i18n/format";
import { routing, type AppLocale } from "@/i18n/routing";
import { MonthCreateForm } from "@/app/[locale]/month-create-form";
import { AppShell } from "@/components/app-shell";
import { Link } from "@/i18n/navigation";

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
    <AppShell email={email} displayName={displayName} signOutAction={startSignOut}>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <PwaInstallPrompt />

        {months.length === 0 ? (
          <section
            aria-labelledby="empty-months"
            className="bg-card text-card-foreground flex flex-col gap-4 rounded-lg border p-6"
          >
            <div className="flex flex-col gap-2">
              <h2 id="empty-months" className="text-lg font-semibold">
                {tm("empty.title")}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {tm("empty.body")}
              </p>
            </div>
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
            <h2 id="month-list" className="text-lg font-semibold">
              {tm("list.title")}
            </h2>
            <ul className="flex flex-col gap-2">
              {months.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/months/${m.year}/${m.month}`}
                    className="bg-card text-card-foreground hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
                  >
                    <span>{monthYear(locale as AppLocale, m.year, m.month)}</span>
                    <span className="text-muted-foreground" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
            <details className="bg-card text-card-foreground rounded-lg border">
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
      </div>
    </AppShell>
  );
}
