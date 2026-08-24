import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { requireUserId } from "@/server/auth/require-user-id";
import { getMonthsByYear } from "@/server/services/months";
import { isAppLocale, monthName } from "@/i18n/format";
import { routing, type AppLocale } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { Link } from "@/i18n/navigation";

export default async function HistoryYearPage({
  params,
}: {
  params: Promise<{ locale: string; year: string }>;
}) {
  const { locale, year: yearParam } = await params;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const year = parseInt(yearParam, 10);
  if (isNaN(year)) {
    redirect({ href: "/history", locale });
  }

  const userId = await requireUserId(locale);
  const t = await getTranslations({ locale, namespace: "history" });
  const currentYear = new Date().getFullYear();

  if (year >= currentYear) {
    redirect({ href: "/history", locale });
  }

  const months = await getMonthsByYear(userId, year);

  const session = await auth();
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const avatarUrl = session?.user?.image ?? null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} avatarUrl={avatarUrl} signOutAction={startSignOut}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Link
            href="/history"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            ← {t("backToYears")}
          </Link>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          {year}
        </h1>

        {months.length === 0 ? (
          <section
            aria-labelledby="empty-year"
            className="bg-card text-card-foreground flex flex-col gap-4 rounded-lg border p-6"
          >
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("year.empty")}
            </p>
          </section>
        ) : (
          <section aria-labelledby="month-list" className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {months.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/months/${m.year}/${m.month}`}
                    className="bg-card text-card-foreground hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
                  >
                    <span>{monthName(locale as AppLocale, m.month)}</span>
                    <span className="text-muted-foreground" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
