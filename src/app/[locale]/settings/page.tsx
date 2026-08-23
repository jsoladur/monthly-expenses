import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import { getProfileSettings } from "@/server/services/settings";
import { SettingsForm } from "./settings-form";
import { routing } from "@/i18n/routing";
import type { ThemePreference } from "@/server/db/schema";
import { AppShell } from "@/components/app-shell";
import { auth, signOut } from "@/auth";

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "MXN", "ARS"] as const;
const FALLBACK_CURRENCY = "EUR";

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

  const userId = await requireUserId(locale);
  const settings = await getProfileSettings(userId);
  const currency = settings?.currency ?? FALLBACK_CURRENCY;
  const theme = (settings?.theme ?? "auto") as ThemePreference;
  const [t, session] = await Promise.all([
    getTranslations({ locale, namespace: "settings" }),
    auth(),
  ]);

  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} signOutAction={startSignOut}>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

        <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>

        <SettingsForm
          currentCurrency={currency}
          supportedCurrencies={SUPPORTED_CURRENCIES}
          currentTheme={theme}
        />
      </div>
    </AppShell>
  );
}
