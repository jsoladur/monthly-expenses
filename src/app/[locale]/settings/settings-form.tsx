"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  updateCurrencyAction,
  updateThemeAction,
  type SettingsActionResult,
  type ThemeActionResult,
} from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import type { ThemePreference } from "@/server/db/schema";

type CurrencyCode = string;

const THEME_OPTIONS: ThemePreference[] = ["auto", "light", "dark"];

export function SettingsForm({
  currentCurrency,
  supportedCurrencies,
  currentTheme,
}: {
  currentCurrency: CurrencyCode;
  supportedCurrencies: ReadonlyArray<CurrencyCode>;
  currentTheme: ThemePreference;
}) {
  const t = useTranslations("settings");
  const tv = useTranslations("validation");
  const { setPreference } = useTheme();
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftCurrency, setDraftCurrency] = useState<CurrencyCode>(currentCurrency);
  const [draftTheme, setDraftTheme] = useState<ThemePreference>(currentTheme);

  const [currencyState, currencyFormAction, currencyPending] = useActionState<
    SettingsActionResult | null,
    FormData
  >(
    async (_prev, formData) => {
      const next = String(formData.get("currency") ?? "").trim();
      const result = await updateCurrencyAction({ currency: next });
      if (result.ok) {
        setBumpOnSuccess((k) => k + 1);
      }
      return result;
    },
    null,
  );

  const [themeState, themeFormAction, themePending] = useActionState<
    ThemeActionResult | null,
    FormData
  >(
    async (_prev, formData) => {
      const next = String(formData.get("theme") ?? "").trim();
      const result = await updateThemeAction({ theme: next });
      if (result.ok) {
        setPreference(next as ThemePreference);
        setBumpOnSuccess((k) => k + 1);
      }
      return result;
    },
    null,
  );

  const currencyFormKey = `${currentCurrency}-${bumpOnSuccess}`;
  const themeFormKey = `${currentTheme}-${bumpOnSuccess}`;
  const currencyError = errorToMessage(currencyState, tv);
  const currencySuccess = currencyState?.ok ? t("status.saved") : null;
  const themeError = themeErrorToMessage(themeState, tv);
  const themeSuccess = themeState?.ok ? t("status.themeSaved") : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        key={currencyFormKey}
        action={currencyFormAction}
        className="flex flex-col gap-2"
        aria-label={t("currency")}
      >
        <label htmlFor="currency" className="text-sm font-medium">
          {t("currency")}
        </label>
        <select
          id="currency"
          name="currency"
          required
          value={draftCurrency}
          onChange={(event) => setDraftCurrency(event.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {supportedCurrencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {currencyError ? (
          <p role="alert" className="text-destructive text-xs">
            {currencyError}
          </p>
        ) : (
          <p
            aria-live="polite"
            className={"text-xs " + (currencySuccess ? "text-foreground" : "text-transparent select-none")}
          >
            {currencySuccess ?? "·"}
          </p>
        )}
        <Button type="submit" disabled={currencyPending} className="self-start">
          {t("actions.save")}
        </Button>
      </form>

      <form
        key={themeFormKey}
        action={themeFormAction}
        className="flex flex-col gap-2"
        aria-label={t("theme")}
      >
        <label htmlFor="theme" className="text-sm font-medium">
          {t("theme")}
        </label>
        <p className="text-muted-foreground text-xs">{t("themeHelp")}</p>
        <select
          id="theme"
          name="theme"
          required
          value={draftTheme}
          onChange={(event) => setDraftTheme(event.target.value as ThemePreference)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`themeOptions.${option}`)}
            </option>
          ))}
        </select>
        {themeError ? (
          <p role="alert" className="text-destructive text-xs">
            {themeError}
          </p>
        ) : (
          <p
            aria-live="polite"
            className={"text-xs " + (themeSuccess ? "text-foreground" : "text-transparent select-none")}
          >
            {themeSuccess ?? "·"}
          </p>
        )}
        <Button type="submit" disabled={themePending} className="self-start">
          {t("actions.save")}
        </Button>
      </form>
    </div>
  );
}

function errorToMessage(
  state: SettingsActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "currencyInvalid":
      return tv("currencyInvalid");
    case "notFound":
      return tv("categoryNotFound");
    case "validation":
      return tv("required");
  }
}

function themeErrorToMessage(
  state: ThemeActionResult | null,
  tv: ReturnType<typeof useTranslations<"validation">>,
): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case "invalidTheme":
      return tv("required");
    case "notFound":
      return tv("categoryNotFound");
    case "validation":
      return tv("required");
  }
}
