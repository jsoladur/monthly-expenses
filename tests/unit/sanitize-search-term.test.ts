import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "@/server/search/sanitize";

describe("sanitizeSearchTerm", () => {
  it('folds "  Café  " to "cafe"', () => {
    expect(sanitizeSearchTerm("  Café  ")).toBe("cafe");
  });

  it('folds "niño" to "nino"', () => {
    expect(sanitizeSearchTerm("niño")).toBe("nino");
  });

  it("returns null for fewer than 3 characters", () => {
    expect(sanitizeSearchTerm("a")).toBeNull();
    expect(sanitizeSearchTerm("ab")).toBeNull();
  });

  it("accepts a 3-character term", () => {
    expect(sanitizeSearchTerm("abc")).toBe("abc");
  });

  it("escapes LIKE wildcards so % and _ are literals", () => {
    expect(sanitizeSearchTerm("%all%")).toBe("\\%all\\%");
  });

  it("collapses internal whitespace", () => {
    expect(sanitizeSearchTerm("oat    milk")).toBe("oat milk");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(sanitizeSearchTerm("")).toBeNull();
    expect(sanitizeSearchTerm("   ")).toBeNull();
    expect(sanitizeSearchTerm("\t\n")).toBeNull();
  });
});
