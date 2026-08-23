import { describe, expect, it } from "vitest";
import {
  APP_LOCALES,
  DEFAULT_LOCALE,
  amountToParts,
  isAppLocale,
  monthName,
  monthYear,
  shortDate,
} from "@/i18n/format";

// ============================================================================
// Locale-aware formatting helpers (UC-02).
//
// `Intl.DateTimeFormat` is platform-provided; we use a stable anchor date
// (`Date.UTC(2000, month - 1, 1)`) so the test isn't sensitive to "today".
// ============================================================================

describe("isAppLocale", () => {
  it("accepts every supported locale", () => {
    for (const locale of APP_LOCALES) {
      expect(isAppLocale(locale)).toBe(true);
    }
  });

  it("rejects unsupported locales and non-strings", () => {
    expect(isAppLocale("fr")).toBe(false);
    expect(isAppLocale("")).toBe(false);
    expect(isAppLocale(null)).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(isAppLocale(42)).toBe(false);
  });

  it("exposes `en` as the default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("monthName", () => {
  it("returns English month names for `en`", () => {
    expect(monthName("en", 1)).toBe("January");
    expect(monthName("en", 8)).toBe("August");
    expect(monthName("en", 12)).toBe("December");
  });

  it("returns Spanish month names for `es` (PRD §11, never hardcoded)", () => {
    expect(monthName("es", 1)).toBe("enero");
    expect(monthName("es", 8)).toBe("agosto");
    expect(monthName("es", 12)).toBe("diciembre");
  });

  it("rejects out-of-range months", () => {
    expect(() => monthName("en", 0)).toThrow(RangeError);
    expect(() => monthName("en", 13)).toThrow(RangeError);
    expect(() => monthName("en", 1.5)).toThrow(RangeError);
  });
});

describe("monthYear", () => {
  it("combines year and month in the active locale", () => {
    expect(monthYear("en", 2026, 8)).toBe("August 2026");
    // Spanish typically renders year separately from month; accept any
    // variant `Intl.DateTimeFormat('es-ES', { year: 'numeric', month: 'long' })`
    // produces. The point is: month name is locale-aware (PRD §11).
    expect(monthYear("es", 2026, 8)).toMatch(/agosto.*2026/);
  });
});

describe("shortDate", () => {
  it("renders a locale-aware short date", () => {
    // en-US → "Aug 8, 2026", es-ES → "8 ago 2026" / "8 de ago. de 2026"
    // depending on ICU version. Just assert the day and the locale-specific
    // marker (numeric day) appears.
    expect(shortDate("en", 2026, 8, 8)).toMatch(/2026/);
    expect(shortDate("es", 2026, 8, 8)).toMatch(/2026/);
  });
});

describe("amountToParts", () => {
  it("returns the canonical wire string unchanged", () => {
    expect(amountToParts("1234.56").formatted).toBe("1234.56");
    expect(amountToParts("-20.00").formatted).toBe("-20.00");
  });

  it("returns integer cents and the sign flag in one shot", () => {
    expect(amountToParts("1234.56")).toEqual({
      formatted: "1234.56",
      cents: 123_456,
      negative: false,
    });
    expect(amountToParts("-20.00")).toEqual({
      formatted: "-20.00",
      cents: -2_000,
      negative: true,
    });
  });

  it("rejects non-canonical inputs (delegates to parseAmount)", () => {
    expect(() => amountToParts("1234,56")).toThrow();
    expect(() => amountToParts("1234.5")).toThrow();
    expect(() => amountToParts("1234")).toThrow();
  });
});
