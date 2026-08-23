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

// ============================================================================
// `formatMoney` — display-only currency formatter (UC-04, PRD C9 / §7.6 / §11).
//
// Wire format is locked by PRD C9: dot-decimal in BOTH locales, exactly two
// fractional digits. `formatMoney` mirrors that on the display side and
// appends the currency label verbatim so the same string is reproducible in
// either locale — this is the "no FX conversion, label only" requirement of
// PRD UC-15. No grouping separator (it would force a locale decision here
// and there is no requirement to introduce one yet).
//
// Negative amounts keep the leading minus (PRD §7.6). Zero renders as
// `0.00 <LABEL>` — no sign.
//
// Throws on non-integer cents or on a non-3-letter label because both are
// domain-contract violations (ADR-5, ARCH §8) — the call site should have
// caught them already (Zod schema in `validators.ts`, `parseAmount` for
// amounts).
// ============================================================================

const CURRENCY_LABEL_RE = /^[A-Z]{3}$/;

export function formatMoney(cents: number, currency: string): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(
      `formatMoney requires integer cents (ADR-5, ARCH §8); received ${cents}`,
    );
  }
  if (typeof currency !== "string" || !CURRENCY_LABEL_RE.test(currency)) {
    throw new TypeError(
      `formatMoney requires a 3-letter ISO 4217 currency code; received ${JSON.stringify(currency)}`,
    );
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = negative ? "-" : "";
  return `${sign}${whole}.${frac.toString().padStart(2, "0")} ${currency}`;
}

function localeOf(locale: AppLocale): string {
  return locale === "es" ? "es-ES" : "en-US";
}
