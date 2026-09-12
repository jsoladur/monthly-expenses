import { describe, expect, it } from "vitest";
import {
  isPassToUpcomingAllowedYear,
  isUpcomingMonthInSameYear,
} from "@/lib/upcoming-months";

// ============================================================================
// UC-18 pass-to-upcoming helpers (PRD §15 #29–#31, C21).
// ============================================================================

describe("isUpcomingMonthInSameYear", () => {
  it("accepts a later month in the same year (2026-09 → 2026-10)", () => {
    expect(
      isUpcomingMonthInSameYear(
        { year: 2026, month: 9 },
        { year: 2026, month: 10 },
      ),
    ).toBe(true);
  });

  it("rejects the same month and earlier months", () => {
    expect(
      isUpcomingMonthInSameYear(
        { year: 2026, month: 9 },
        { year: 2026, month: 9 },
      ),
    ).toBe(false);
    expect(
      isUpcomingMonthInSameYear(
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ),
    ).toBe(false);
  });

  it("rejects a different year (2026-09 → 2027-01)", () => {
    expect(
      isUpcomingMonthInSameYear(
        { year: 2026, month: 9 },
        { year: 2027, month: 1 },
      ),
    ).toBe(false);
  });
});

describe("isPassToUpcomingAllowedYear", () => {
  const now = new Date("2026-09-12T12:00:00Z");

  it("allows the current calendar year", () => {
    expect(isPassToUpcomingAllowedYear(2026, now)).toBe(true);
  });

  it("rejects a previous year", () => {
    expect(isPassToUpcomingAllowedYear(2025, now)).toBe(false);
  });
});
