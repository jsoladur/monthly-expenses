import { describe, expect, it } from "vitest";
import {
  EmptyScheduleError,
  InvalidScheduleError,
  appliesToMonth,
  normalizeMonths,
} from "@/lib/template-schedule";
import { monthShortName } from "@/i18n/format";

// ============================================================================
// UC-20 fixed expense month schedule helpers (PRD §15 #37, C23).
// ============================================================================

describe("normalizeMonths", () => {
  it("keeps null / undefined as null (every month)", () => {
    expect(normalizeMonths(null)).toBeNull();
    expect(normalizeMonths(undefined)).toBeNull();
  });

  it("collapses a 12-month schedule to null", () => {
    expect(normalizeMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeNull();
    expect(normalizeMonths([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1])).toBeNull();
  });

  it("rejects an empty schedule", () => {
    expect(() => normalizeMonths([])).toThrow(EmptyScheduleError);
  });

  it("sorts and de-duplicates", () => {
    expect(normalizeMonths([3, 1, 3])).toEqual([1, 3]);
    expect(normalizeMonths([10, 7, 1, 3])).toEqual([1, 3, 7, 10]);
  });

  it("rejects months outside 1–12 and non-integers", () => {
    expect(() => normalizeMonths([13])).toThrow(InvalidScheduleError);
    expect(() => normalizeMonths([0])).toThrow(InvalidScheduleError);
    expect(() => normalizeMonths([1.5])).toThrow(InvalidScheduleError);
  });
});

describe("appliesToMonth", () => {
  it("null schedule applies to every month", () => {
    for (let m = 1; m <= 12; m++) expect(appliesToMonth(null, m)).toBe(true);
  });

  it("a schedule applies only to its months", () => {
    expect(appliesToMonth([1, 3, 7, 10], 1)).toBe(true);
    expect(appliesToMonth([1, 3, 7, 10], 2)).toBe(false);
  });
});

describe("monthShortName", () => {
  it("returns capitalized locale short names without trailing dots", () => {
    expect(monthShortName("en", 1)).toBe("Jan");
    expect(monthShortName("es", 1)).toBe("Ene");
    for (let m = 1; m <= 12; m++) {
      expect(monthShortName("es", m)).not.toMatch(/\.$/);
    }
  });

  it("rejects out-of-range months", () => {
    expect(() => monthShortName("en", 13)).toThrow(RangeError);
  });
});
