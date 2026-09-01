import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { requireUserId } from "@/server/auth/require-user-id";
import { isAppLocale } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { getGlobalStatsPage } from "@/server/services/global-stats";
import { GlobalStatsScreen } from "@/app/[locale]/stats/global-stats-screen";

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const sp = await searchParams;
  const page = await getGlobalStatsPage(userId, sp);
  const t = await getTranslations({ locale, namespace: "stats" });

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <GlobalStatsScreen page={page} />
      </div>
    </AppShell>
  );
}
