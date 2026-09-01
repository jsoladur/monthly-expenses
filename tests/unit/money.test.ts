import { describe, expect, it } from "vitest";
import {
  AmountFormatError,
  cagrPercentTenths,
  formatCents,
  formatPercentTenths,
  negateCents,
  parseAmount,
  ratioChangeToPercentTenths,
  sumCents,
} from "@/server/money";

describe("parseAmount", () => {
  it("parses positive amounts", () => {
    expect(parseAmount("1234.56")).toBe(123_456);
    expect(parseAmount("0.00")).toBe(0);
    expect(parseAmount("0.99")).toBe(99);
    expect(parseAmount("1.00")).toBe(100);
  });

  it("parses negative amounts (PRD §7.6)", () => {
    expect(parseAmount("-20.00")).toBe(-2_000);
    expect(parseAmount("-0.01")).toBe(-1);
    expect(parseAmount("-1234.56")).toBe(-123_456);
  });

  it("round-trips through formatCents", () => {
    const cases = ["0.00", "1.00", "1234.56", "999999999999.99", "-20.00", "-0.01"];
    for (const c of cases) {
      expect(formatCents(parseAmount(c))).toBe(c);
    }
  });

  it("rejects non-string input", () => {
    expect(() => parseAmount(1234.56 as unknown as string)).toThrow(AmountFormatError);
    expect(() => parseAmount(null as unknown as string)).toThrow(AmountFormatError);
  });

  it("rejects missing decimals", () => {
    expect(() => parseAmount("1234")).toThrow(AmountFormatError);
  });

  it("rejects extra decimals", () => {
    expect(() => parseAmount("1234.567")).toThrow(AmountFormatError);
  });

  it("rejects a single decimal", () => {
    expect(() => parseAmount("1234.5")).toThrow(AmountFormatError);
  });

  it("rejects thousands separators", () => {
    expect(() => parseAmount("1,234.56")).toThrow(AmountFormatError);
  });

  it("rejects more than 12 integer digits", () => {
    expect(() => parseAmount("1234567890123.00")).toThrow(AmountFormatError);
  });

  it("accepts the boundary of 12 integer digits", () => {
    expect(parseAmount("999999999999.99")).toBe(99_999_999_999_999);
  });

  it("rejects whitespace inside the string", () => {
    expect(() => parseAmount(" 1234.56")).toThrow(AmountFormatError);
    expect(() => parseAmount("1234.56 ")).toThrow(AmountFormatError);
  });
});

describe("formatCents", () => {
  it("always renders exactly 2 fractional digits", () => {
    expect(formatCents(1)).toBe("0.01");
    expect(formatCents(100)).toBe("1.00");
    expect(formatCents(0)).toBe("0.00");
  });

  it("renders negatives with a leading minus", () => {
    expect(formatCents(-1)).toBe("-0.01");
    expect(formatCents(-123_456)).toBe("-1234.56");
  });

  it("rejects non-integer values", () => {
    expect(() => formatCents(1.5)).toThrow(TypeError);
    expect(() => formatCents(Number.NaN)).toThrow(TypeError);
    expect(() => formatCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("sumCents", () => {
  it("sums an empty array to zero", () => {
    expect(sumCents([])).toBe(0);
  });

  it("sums positive and negative amounts exactly", () => {
    expect(sumCents([100, 200, -50, 50])).toBe(300);
  });

  it("handles the potential-savings formula inputs without loss", () => {
    // 2000.00 - (0 + 800 + 400)  →  800.00  →  80_000 cents
    const incomes = [200_000];
    const actuals: number[] = [];
    const remaining = [80_000, 40_000];
    const savings = sumCents(incomes) - (sumCents(actuals) + sumCents(remaining));
    expect(savings).toBe(80_000);
  });

  it("rejects non-integer values to keep arithmetic exact", () => {
    expect(() => sumCents([100, 1.5])).toThrow(TypeError);
  });
});

describe("negateCents", () => {
  it("flips the sign", () => {
    expect(negateCents(123_456)).toBe(-123_456);
    expect(negateCents(-99)).toBe(99);
    expect(negateCents(0)).toBe(-0);
  });
});

describe("ratioChangeToPercentTenths", () => {
  it("HCC 800.00 vs 640.00 → 25.0% (tenths 250)", () => {
    expect(ratioChangeToPercentTenths(80_000, 64_000)).toBe(250);
  });

  it("returns null when prior is 0", () => {
    expect(ratioChangeToPercentTenths(80_000, 0)).toBeNull();
  });

  it("rounds half-up at one decimal", () => {
    // 1/3 → 33.333…% → 33.3%
    expect(ratioChangeToPercentTenths(400, 300)).toBe(333);
  });
});

describe("cagrPercentTenths", () => {
  it("skips when base spend is 0", () => {
    expect(cagrPercentTenths(0, 80_000, 3)).toBeNull();
  });

  it("matches YoY when years = 1", () => {
    expect(cagrPercentTenths(64_000, 80_000, 1)).toBe(250);
  });

  it("computes a 10% 2-year CAGR from integer cents", () => {
    // 100.00 → 121.00 over 2 years → 10.0%
    expect(cagrPercentTenths(10_000, 12_100, 2)).toBe(100);
  });
});

describe("formatPercentTenths", () => {
  it("renders one decimal", () => {
    expect(formatPercentTenths(250)).toBe("25.0");
    expect(formatPercentTenths(-50)).toBe("-5.0");
    expect(formatPercentTenths(3)).toBe("0.3");
  });
});
