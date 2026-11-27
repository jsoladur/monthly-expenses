import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { getWorkspaceCurrency, listMyWorkspaces } from "@/server/services/workspaces";
import { roleAllows } from "@/lib/workspace-roles";
import { Link } from "@/i18n/navigation";
import { ChevronRight, Users } from "lucide-react";
import { getProfileSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";
import { routing } from "@/i18n/routing";
import type { ThemePreference } from "@/server/db/schema";
import { AppShell } from "@/components/app-shell";
import { auth, signOut } from "@/auth";
import { SUPPORTED_CURRENCIES } from "@/lib/workspace-name";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/settings", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const access = await resolveActiveWorkspace(locale);
  // Currency: the ACTIVE workspace's (UC-31 §7.3). Theme: per user (UC-21).
  const [currency, profile, myWorkspaces] = await Promise.all([
    getWorkspaceCurrency(access),
    getProfileSettings(access.userId),
    listMyWorkspaces(access.userId),
  ]);
  const multiWorkspace = myWorkspaces.length > 1;
  const active = myWorkspaces.find((w) => w.id === access.workspaceId);
  const theme = (profile?.theme ?? "auto") as ThemePreference;
  const [t, tw, session] = await Promise.all([
    getTranslations({ locale, namespace: "settings" }),
    getTranslations({ locale, namespace: "workspaces" }),
    auth(),
  ]);
  const activeName =
    active?.kind === "shared" && active.name ? active.name : tw("privateLabel");

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

        <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>

        <SettingsForm
          currentCurrency={currency}
          supportedCurrencies={SUPPORTED_CURRENCIES}
          currentTheme={theme}
          canEditCurrency={roleAllows(access.role, "manageWorkspace")}
          currencyLabel={multiWorkspace ? t("currencyFor", { name: activeName }) : undefined}
        />

        {/* Link to the Workspaces section (its own nav entry since the PO
            decision of 2026-11-27); shown in every mode. */}
          <Link
            href="/workspaces"
            className="bg-card text-card-foreground hover:bg-accent flex min-h-11 items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          >
            <Users className="text-muted-foreground size-5 shrink-0" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t("workspaces.title")}</span>
              <span className="text-muted-foreground text-xs">{t("workspaces.help")}</span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </Link>
      </div>
    </AppShell>
  );
}
