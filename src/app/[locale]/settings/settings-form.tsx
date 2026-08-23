"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  updateCurrencyAction,
  type SettingsActionResult,
} from "@/actions/settings";
import { Button } from "@/components/ui/button";

// ============================================================================
// Settings form (UC-04).
//
// Controlled input with `useActionState`. The currency select ships with
// the user's current choice; on submit we hand off to the server action.
// A successful save bumps a `formKey` so the input remounts with the new
// current value (the action also revalidates the page, but the
// `aria-live="polite"` confirmation message is the visible feedback).
//
// We use a native `<select>` because (a) the short list fits without
// combobox ergonomics and (b) it gets us free i18n of the option labels
// via the `lang` attribute on the parent <main>.
// ============================================================================

type CurrencyCode = string;

export function SettingsForm({
  currentCurrency,
  supportedCurrencies,
}: {
  currentCurrency: CurrencyCode;
  supportedCurrencies: ReadonlyArray<CurrencyCode>;
}) {
  const t = useTranslations("settings");
  const tv = useTranslations("validation");
  const [bumpOnSuccess, setBumpOnSuccess] = useState(0);
  const [draftCurrency, setDraftCurrency] = useState<CurrencyCode>(currentCurrency);

  const [state, formAction, pending] = useActionState<SettingsActionResult | null, FormData>(
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

  // `formKey` is bumped on success so the select's `defaultValue` is
  // re-read from the freshly-revalidated `currentCurrency` prop.
  const formKey = `${currentCurrency}-${bumpOnSuccess}`;
  const errorMessage = errorToMessage(state, tv);
  const successMessage = state?.ok ? t("status.saved") : null;

  return (
    <form
      key={formKey}
      action={formAction}
      className="flex flex-col gap-2"
      aria-label={t("title")}
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
      {errorMessage ? (
        <p role="alert" className="text-destructive text-xs">
          {errorMessage}
        </p>
      ) : (
        <p
          aria-live="polite"
          className={"text-xs " + (successMessage ? "text-foreground" : "text-transparent select-none")}
        >
          {successMessage ?? "·"}
        </p>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {t("actions.save")}
      </Button>
    </form>
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
