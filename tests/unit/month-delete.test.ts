import { describe, expect, it } from "vitest";
import { matchesMonthLabel } from "@/lib/month-delete";
import { monthYear } from "@/i18n/format";

// UC-27 typed-confirmation guard.
describe("matchesMonthLabel", () => {
  it("accepts the exact label", () => {
    expect(matchesMonthLabel("November 2026", "November 2026", "en")).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(matchesMonthLabel("  november 2026 ", "November 2026", "en")).toBe(true);
    expect(matchesMonthLabel("NOVIEMBRE DE 2026", "noviembre de 2026", "es")).toBe(true);
  });

  it("collapses inner whitespace", () => {
    expect(matchesMonthLabel("November   2026", "November 2026", "en")).toBe(true);
  });

  it("rejects another month or year", () => {
    expect(matchesMonthLabel("October 2026", "November 2026", "en")).toBe(false);
    expect(matchesMonthLabel("November 2025", "November 2026", "en")).toBe(false);
    expect(matchesMonthLabel("November", "November 2026", "en")).toBe(false);
  });

  it("rejects empty input and an empty label", () => {
    expect(matchesMonthLabel("", "November 2026", "en")).toBe(false);
    expect(matchesMonthLabel("", "", "en")).toBe(false);
  });

  it("matches the label the workspace header renders in both locales", () => {
    const en = monthYear("en", 2026, 11);
    const es = monthYear("es", 2026, 11);
    expect(matchesMonthLabel(en.toUpperCase(), en, "en")).toBe(true);
    expect(matchesMonthLabel(es, es, "es")).toBe(true);
    expect(matchesMonthLabel(en, es, "es")).toBe(false);
  });
});
