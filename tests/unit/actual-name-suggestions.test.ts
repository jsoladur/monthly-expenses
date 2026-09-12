import { describe, expect, it } from "vitest";
import {
  filterNameSuggestions,
  recentMonthWindow,
  type ActualNameSuggestion,
} from "@/lib/actual-name-suggestions";

function suggestion(name: string, year = 2026, month = 8): ActualNameSuggestion {
  return { name, year, month };
}

describe("recentMonthWindow", () => {
  it("returns the open month plus two calendar months back", () => {
    expect(recentMonthWindow(2026, 8)).toEqual([
      { year: 2026, month: 8 },
      { year: 2026, month: 7 },
      { year: 2026, month: 6 },
    ]);
  });

  it("wraps across the year boundary", () => {
    expect(recentMonthWindow(2026, 1)).toEqual([
      { year: 2026, month: 1 },
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
    ]);
  });
});

describe("filterNameSuggestions", () => {
  const corpus = [
    suggestion("Café Central", 2026, 8),
    suggestion("Carrefour", 2026, 7),
    suggestion("Pan", 2026, 6),
    suggestion("Card fee", 2026, 8),
    suggestion("Cabify", 2026, 8),
    suggestion("Cactus shop", 2026, 7),
    suggestion("Camera film", 2026, 6),
  ];

  it('matches "ca" as a prefix, including accented names', () => {
    const hits = filterNameSuggestions(corpus, "ca");
    expect(hits.map((h) => h.name)).toEqual([
      "Café Central",
      "Carrefour",
      "Card fee",
      "Cabify",
      "Cactus shop",
    ]);
  });

  it("does not match a non-prefix substring", () => {
    expect(filterNameSuggestions(corpus, "central")).toEqual([]);
  });

  it("returns nothing for a single character", () => {
    expect(filterNameSuggestions(corpus, "a")).toEqual([]);
    expect(filterNameSuggestions(corpus, "c")).toEqual([]);
  });

  it("omits an exact folded match of the current input", () => {
    expect(filterNameSuggestions([suggestion("Café")], "café")).toEqual([]);
    expect(filterNameSuggestions([suggestion("Café")], "CAFE")).toEqual([]);
  });

  it("caps at five suggestions, preserving corpus (recency) order", () => {
    const hits = filterNameSuggestions(corpus, "ca", 5);
    expect(hits).toHaveLength(5);
    expect(hits.map((h) => h.name)).not.toContain("Camera film");
  });
});
