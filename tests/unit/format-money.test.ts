import { describe, expect, it } from "vitest";
import { formatMoney } from "@/i18n/format";

// ============================================================================
// UC-04 money formatting (PRD C9, §7.6, §11; ARCH §8).
//
// The wire format is dot-decimal in BOTH locales (PRD C9). `formatMoney`
// produces a stable, locale-independent display: `<sign><amount> <LABEL>`
// with exactly two fractional digits, no grouping separators. Grouping
// separators would have to be locale-aware and that introduces a second
// source of truth; the PRD pins amount format to dot-decimal everywhere,
// so we keep display consistent with input.
//
// Future slices that need grouping separators can add a locale-aware helper
// without changing this one.
// ============================================================================

describe("formatMoney", () => {
  it("renders positive cents as `<amount> <CURRENCY>` with two decimals", () => {
    expect(formatMoney(123456, "EUR")).toBe("1234.56 EUR");
    expect(formatMoney(100, "EUR")).toBe("1.00 EUR");
  });

  it("renders zero as `0.00 <CURRENCY>` (no negative sign)", () => {
    expect(formatMoney(0, "EUR")).toBe("0.00 EUR");
    expect(formatMoney(0, "USD")).toBe("0.00 USD");
  });

  it("renders negative cents with a leading minus — PRD §7.6", () => {
    expect(formatMoney(-2000, "EUR")).toBe("-20.00 EUR");
    expect(formatMoney(-1, "EUR")).toBe("-0.01 EUR");
  });

  it("pads single-digit fractional amounts so the wire format has exactly two decimals", () => {
    // Bigint-safe — 5 cents is the smallest nonzero amount.
    expect(formatMoney(5, "EUR")).toBe("0.05 EUR");
    expect(formatMoney(9, "EUR")).toBe("0.09 EUR");
  });

  it("supports the full numeric(14,2) range", () => {
    // 9_999_999_999_999.99 → 999_999_999_999_999 cents (within Number.MAX_SAFE_INTEGER)
    expect(formatMoney(999_999_999_999_999, "EUR")).toBe("9999999999999.99 EUR");
    expect(formatMoney(-999_999_999_999_999, "EUR")).toBe("-9999999999999.99 EUR");
  });

  it("preserves the user's chosen currency label verbatim (USD / GBP / JPY / etc.)", () => {
    expect(formatMoney(5000, "USD")).toBe("50.00 USD");
    expect(formatMoney(5000, "GBP")).toBe("50.00 GBP");
  });

  it("rejects non-integer cents — the domain contract (ADR-5, ARCH §8)", () => {
    expect(() => formatMoney(1.5, "EUR")).toThrow(TypeError);
    expect(() => formatMoney(Number.NaN, "EUR")).toThrow(TypeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY, "EUR")).toThrow(TypeError);
  });

  it("rejects empty / non-3-letter currency codes — wire format requires char(3)", () => {
    expect(() => formatMoney(0, "")).toThrow(TypeError);
    expect(() => formatMoney(0, "EU")).toThrow(TypeError);
    expect(() => formatMoney(0, "EURO")).toThrow(TypeError);
    expect(() => formatMoney(0, "eu1")).toThrow(TypeError);
  });
});
