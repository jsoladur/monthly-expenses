import { describe, expect, it } from "vitest";
import { isHistoryYear, isHomeYear } from "@/lib/month-buckets";

// ============================================================================
// Home vs History split (PRD UC-14): current and later years on Home,
// earlier years in History, never both and never neither.
// ============================================================================

const now = new Date(2026, 10, 26); // 26 Nov 2026, local time

describe("isHomeYear / isHistoryYear", () => {
  it("puts the current year on Home, not in History", () => {
    expect(isHomeYear(2026, now)).toBe(true);
    expect(isHistoryYear(2026, now)).toBe(false);
  });

  it("puts a later year (January 2027 created ahead) on Home, not in History", () => {
    expect(isHomeYear(2027, now)).toBe(true);
    expect(isHistoryYear(2027, now)).toBe(false);
    expect(isHomeYear(2030, now)).toBe(true);
  });

  it("puts earlier years in History, not on Home", () => {
    expect(isHomeYear(2025, now)).toBe(false);
    expect(isHistoryYear(2025, now)).toBe(true);
    expect(isHistoryYear(2019, now)).toBe(true);
  });

  it("assigns every year to exactly one bucket", () => {
    for (let year = 2015; year <= 2035; year++) {
      expect(isHomeYear(year, now)).not.toBe(isHistoryYear(year, now));
    }
  });
});
