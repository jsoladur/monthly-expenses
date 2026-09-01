import { describe, expect, it } from "vitest";
import { formatAxisCents, formatMoney } from "@/i18n/format";

// ============================================================================
// UC-04 money formatting (PRD C9, §7.6, §11; ARCH §8).
//
// Wire/input stay dot-decimal in BOTH locales (PRD C9). Display uses a
// comma thousands separator and a dot before cents: `1,234.56 €`.
// ============================================================================

describe("formatMoney", () => {
  it("renders positive cents as `<amount> <SYMBOL>` with two decimals", () => {
    expect(formatMoney(123456, "EUR")).toBe("1,234.56 €");
    expect(formatMoney(100, "EUR")).toBe("1.00 €");
  });

  it("groups thousands with a comma (display only; decimal stays a dot)", () => {
    expect(formatMoney(15_092_367, "EUR")).toBe("150,923.67 €");
    expect(formatMoney(100_000, "EUR")).toBe("1,000.00 €");
  });

  it("renders zero as `0.00 <SYMBOL>` (no negative sign)", () => {
    expect(formatMoney(0, "EUR")).toBe("0.00 €");
    expect(formatMoney(0, "USD")).toBe("0.00 $");
  });

  it("renders negative cents with a leading minus — PRD §7.6", () => {
    expect(formatMoney(-2000, "EUR")).toBe("-20.00 €");
    expect(formatMoney(-1, "EUR")).toBe("-0.01 €");
    expect(formatMoney(-15_092_367, "EUR")).toBe("-150,923.67 €");
  });

  it("pads single-digit fractional amounts so the wire format has exactly two decimals", () => {
    // Bigint-safe — 5 cents is the smallest nonzero amount.
    expect(formatMoney(5, "EUR")).toBe("0.05 €");
    expect(formatMoney(9, "EUR")).toBe("0.09 €");
  });

  it("supports the full numeric(14,2) range", () => {
    // 9_999_999_999_999.99 → 999_999_999_999_999 cents (within Number.MAX_SAFE_INTEGER)
    expect(formatMoney(999_999_999_999_999, "EUR")).toBe("9,999,999,999,999.99 €");
    expect(formatMoney(-999_999_999_999_999, "EUR")).toBe("-9,999,999,999,999.99 €");
  });

  it("uses currency symbols for known currencies (USD / GBP / JPY / etc.)", () => {
    expect(formatMoney(5000, "USD")).toBe("50.00 $");
    expect(formatMoney(5000, "GBP")).toBe("50.00 £");
    expect(formatMoney(5000, "JPY")).toBe("50.00 ¥");
  });

  it("falls back to ISO code for unknown currencies", () => {
    expect(formatMoney(5000, "XYZ")).toBe("50.00 XYZ");
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

describe("formatAxisCents", () => {
  it("shows whole units with grouping under 100k", () => {
    expect(formatAxisCents(8_050_000)).toBe("80,500");
    expect(formatAxisCents(9_999_900)).toBe("99,999");
  });

  it("compacts large ticks without float money math", () => {
    expect(formatAxisCents(12_000_000)).toBe("120k");
    expect(formatAxisCents(200_000_000)).toBe("2M");
  });

  it("keeps a leading minus", () => {
    expect(formatAxisCents(-8_050_000)).toBe("-80,500");
  });
});
