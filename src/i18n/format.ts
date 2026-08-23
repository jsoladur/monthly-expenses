// ============================================================================
// Locale-aware formatting helpers (UC-02, PRD §11).
//
// Month names are resolved via `Intl.DateTimeFormat` so they follow the
// active locale (`en` → "August", `es` → "agosto"). NEVER hardcode the
// month name; later slices render dozens of these across the workspace
// and templates screens.
//
// `amountToParts` returns the canonical "1234.56" / "-20.00" wire string and
// its sign in one shot — both come from the same parse so they can never
// disagree. The format itself is fixed by PRD C9 / §11 (dot decimal in
// BOTH locales); the locale only changes the *display* (currency symbol,
// grouping separators), not the input format.
// ============================================================================

import { parseAmount } from "@/server/money";
import { routing, type AppLocale } from "@/i18n/routing";

export const APP_LOCALES: ReadonlyArray<AppLocale> = routing.locales;
export const DEFAULT_LOCALE: AppLocale = routing.defaultLocale;

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (APP_LOCALES as ReadonlyArray<string>).includes(value)
  );
}

export function monthName(locale: AppLocale, month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be an integer in 1..12, received ${month}`);
  }
  // `Date(2000, month - 1, 1)` gives a deterministic anchor; year/month/day
  // are arbitrary as long as the month is correct and the date is valid.
  return new Intl.DateTimeFormat(localeOf(locale), { month: "long" }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

export function monthYear(locale: AppLocale, year: number, month: number): string {
  if (!Number.isInteger(year)) {
    throw new RangeError(`year must be an integer, received ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be an integer in 1..12, received ${month}`);
  }
  return new Intl.DateTimeFormat(localeOf(locale), {
    year: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function shortDate(
  locale: AppLocale,
  year: number,
  month: number,
  day: number,
): string {
  return new Intl.DateTimeFormat(localeOf(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export interface AmountParts {
  formatted: string;
  cents: number;
  negative: boolean;
}

export function amountToParts(amount: string): AmountParts {
  const cents = parseAmount(amount);
  return {
    formatted: amount,
    cents,
    negative: cents < 0,
  };
}

function localeOf(locale: AppLocale): string {
  return locale === "es" ? "es-ES" : "en-US";
}
