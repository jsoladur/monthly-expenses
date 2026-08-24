import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { requireUserId } from "@/server/auth/require-user-id";
import { getMonthYears } from "@/server/services/months";
import { isAppLocale } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { Link } from "@/i18n/navigation";

export default async function HistoryPage({
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
  const t = await getTranslations({ locale, namespace: "history" });
  const currentYear = new Date().getFullYear();

  const years = await getMonthYears(userId);
  const previousYears = years.filter((y) => y < currentYear);

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
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>

        {previousYears.length === 0 ? (
          <section
            aria-labelledby="empty-history"
            className="bg-card text-card-foreground flex flex-col gap-4 rounded-lg border p-6"
          >
            <div className="flex flex-col gap-2">
              <h2 id="empty-history" className="text-lg font-semibold">
                {t("empty.title")}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t("empty.body")}
              </p>
            </div>
          </section>
        ) : (
          <section aria-labelledby="year-list" className="flex flex-col gap-4">
            <h2 id="year-list" className="text-lg font-semibold">
              {t("years.title")}
            </h2>
            <ul className="flex flex-col gap-2">
              {previousYears.map((year) => (
                <li key={year}>
                  <Link
                    href={`/history/${year}`}
                    className="bg-card text-card-foreground hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
                  >
                    <span>{year}</span>
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
