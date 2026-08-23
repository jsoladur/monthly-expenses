import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import { getProfileSettings } from "@/server/services/settings";
import { LanguageSwitcher } from "@/components/language-switcher";
import { formatMoney } from "@/i18n/format";
import { SettingsForm } from "./settings-form";
import { routing } from "@/i18n/routing";
import type { ThemePreference } from "@/server/db/schema";
import { AppShell } from "@/components/app-shell";

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
  const [t] = await Promise.all([
    getTranslations({ locale, namespace: "settings" }),
  ]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <LanguageSwitcher />
        </div>

        <section className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>
          <dl className="bg-muted/30 border-border/60 rounded-lg border px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t("currentLabel")}</dt>
              <dd className="font-mono font-medium tracking-wide">{currency}</dd>
            </div>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium">{t("preview.label")}</h2>
          <ul className="border-border/60 divide-border/60 flex flex-col divide-y rounded-lg border text-sm">
            <PreviewRow label={t("preview.positive")} text={formatMoney(123456, currency)} />
            <PreviewRow label={t("preview.zero")} text={formatMoney(0, currency)} />
            <PreviewRow label={t("preview.negative")} text={formatMoney(-2000, currency)} />
          </ul>
        </section>

        <SettingsForm
          currentCurrency={currency}
          supportedCurrencies={SUPPORTED_CURRENCIES}
          currentTheme={theme}
        />
      </div>
    </AppShell>
  );
}

function PreviewRow({ label, text }: { label: string; text: string }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2">
      <span className="text-muted-foreground font-mono text-xs">{label}</span>
      <span className="amount font-mono font-medium">{text}</span>
    </li>
  );
}
