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

// ============================================================================
// Settings screen (UC-04, PRD §5.3 / UC-15 / screen 8, ARCH §4).
//
// Thin RSC shell that:
//   1. Resolves the tenant (`requireUserId()` — PRD §5.1, ARCH §3.2 rule 4).
//   2. Reads the current `profile_settings` row (defaults to EUR if UC-01's
//      first-sign-in transaction is somehow missing — the slice spec is
//      explicit that the default IS EUR).
//   3. Renders a preview block (`formatMoney` of a few sample amounts in
//      the active currency) so the user can confirm the label change
//      before saving. The preview is display-only — never persisted
//      (PRD UC-15: no FX conversion).
//   4. Hands off to the client `SettingsForm` for the currency picker.
//
// The mutation goes through `src/actions/settings.ts#updateCurrencyAction`,
// which calls `revalidatePath("/[locale]/settings", "page")` so the next
// render sees the new value (and the home page, which surfaces the
// currency later in UC-06).
// ============================================================================

// The user's likely-curated short list of common currencies. Kept inline
// so this slice doesn't need to ship a 200-code list. UC-19 (or whatever
// the catalog-management slice ends up being) can replace this with the
// full ISO 4217 list if the user wants to type their own.
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
  const [t, tn] = await Promise.all([
    getTranslations({ locale, namespace: "settings" }),
    getTranslations({ locale, namespace: "nav" }),
  ]);

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-4 py-8"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <LanguageSwitcher />
      </div>
      <nav className="flex flex-wrap gap-3 text-sm">
        <a className="text-muted-foreground underline-offset-4 hover:underline" href={`/${locale}`}>
          {tn("home")}
        </a>
        <a
          className="text-muted-foreground underline-offset-4 hover:underline"
          href={`/${locale}/categories`}
        >
          {tn("categories")}
        </a>
      </nav>

      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>
        <dl className="border-border/60 bg-muted/30 rounded-md border px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{t("currentLabel")}</dt>
            <dd className="font-mono font-medium tracking-wide">{currency}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("preview.label")}</h2>
        <ul className="border-border/60 divide-border/60 flex flex-col divide-y rounded-md border text-sm">
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
    </main>
  );
}

function PreviewRow({ label, text }: { label: string; text: string }) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-2">
      <span className="text-muted-foreground font-mono text-xs">{label}</span>
      <span className="font-mono font-medium">{text}</span>
    </li>
  );
}
