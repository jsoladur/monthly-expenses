import { redirect } from "@/i18n/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { isAppLocale } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { getWorkspaceCurrency } from "@/server/services/workspaces";
import { searchActuals } from "@/server/services/search";
import { SearchScreen } from "@/app/[locale]/search/search-screen";

export default async function SearchPage({
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

  const access = await resolveActiveWorkspace(locale);
  const sp = await searchParams;
  const rawQuery = firstString(sp.q);
  const [result, settings, session] = await Promise.all([
    searchActuals(access, rawQuery),
    getWorkspaceCurrency(access),
    auth(),
  ]);
  const currency = settings;
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const avatarUrl = session?.user?.image ?? null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} avatarUrl={avatarUrl} signOutAction={startSignOut}>
      <SearchScreen
        key={rawQuery}
        currency={currency}
        rawQuery={rawQuery}
        result={result}
      />
    </AppShell>
  );
}

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
