import { describe, expect, it } from "vitest";
import {
  dedupePeriods,
  dedupeYearsDescending,
  exportFilename,
  sanitizeSheetName,
  sortPeriodsDescending,
  uniqueYearsDescending,
} from "@/lib/export-selection";

describe("export selection helpers (UC-19)", () => {
  it("sorts periods newest first", () => {
    expect(
      sortPeriodsDescending([
        { year: 2025, month: 12 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ]),
    ).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]);
  });

  it("lists unique years descending", () => {
    expect(
      uniqueYearsDescending([
        { year: 2025, month: 12 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ]),
    ).toEqual([2026, 2025]);
    expect(dedupeYearsDescending([2025, 2026, 2026, 2024])).toEqual([
      2026, 2025, 2024,
    ]);
  });

  it("builds filenames from the selected scope", () => {
    expect(exportFilename({ mode: "all" })).toBe("monthly-expenses-all.xlsx");
    expect(exportFilename({ mode: "year", years: [2026] })).toBe(
      "monthly-expenses-2026.xlsx",
    );
    expect(exportFilename({ mode: "year", years: [2026, 2025] })).toBe(
      "monthly-expenses-selected.xlsx",
    );
    expect(
      exportFilename({
        mode: "months",
        periods: [{ year: 2026, month: 9 }],
      }),
    ).toBe("monthly-expenses-2026-09.xlsx");
    expect(
      exportFilename({
        mode: "months",
        periods: [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ],
      }),
    ).toBe("monthly-expenses-selected.xlsx");
  });

  it("dedupes periods and keeps descending order", () => {
    expect(
      dedupePeriods([
        { year: 2026, month: 8 },
        { year: 2026, month: 8 },
        { year: 2026, month: 9 },
      ]),
    ).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]);
  });

  it("sanitizes sheet names and keeps the YYYY-MM prefix under 31 chars", () => {
    expect(sanitizeSheetName(2026, 9, "September")).toBe("2026-09 September");
    expect(sanitizeSheetName(2026, 9, "Sep[tem]ber?*")).toBe("2026-09 Sep tem ber");
    const long = sanitizeSheetName(
      2026,
      9,
      "A very long locale month name that would overflow",
    );
    expect(long.startsWith("2026-09")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(31);
  });
});
