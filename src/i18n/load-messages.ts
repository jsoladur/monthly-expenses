import "server-only";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

// ============================================================================
// Minimal message loader for UC-01.
//
// Loads a flat JSON dictionary by locale. UC-02 (i18n shell) replaces this
// helper with the full next-intl `defineRouting` + `getRequestConfig` setup
// (locale cookie, browser Accept-Language fallback, middleware). Until then
// this keeps the slice small and lets the sign-in + 403 screens render
// translated copy keyed under `auth.signIn.*` and `auth.forbidden.*`.
// ============================================================================

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as ReadonlyArray<string>).includes(value);
}

type Messages = (typeof en) & (typeof es);

const MESSAGES: Readonly<Record<Locale, Messages>> = {
  en,
  es,
};

export function loadMessages(locale: string): Messages {
  if (isSupportedLocale(locale)) {
    return MESSAGES[locale];
  }
  return MESSAGES[DEFAULT_LOCALE];
}

export function getMessage<M extends keyof Messages>(
  messages: Messages,
  group: M,
): Messages[M] {
  return messages[group];
}
