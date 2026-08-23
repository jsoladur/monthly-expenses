import { describe, expect, it } from "vitest";
import {
  AmountFormatError,
  formatCents,
  negateCents,
  parseAmount,
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
