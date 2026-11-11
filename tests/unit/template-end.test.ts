import { describe, expect, it } from "vitest";
import {
  EndMonthOnEstimatedError,
  InvalidEndMonthError,
  hasEndedBy,
  isCopiedInto,
  normalizeEndMonth,
} from "@/lib/template-end";

// UC-29 (PRD C29): last payment month of a committed fixed expense.

describe("normalizeEndMonth", () => {
  it("treats null and undefined as no last payment month", () => {
    expect(normalizeEndMonth("committed", null)).toBeNull();
    expect(normalizeEndMonth("committed", undefined)).toBeNull();
    expect(normalizeEndMonth("estimated", null)).toBeNull();
  });

  it("keeps a valid month on a committed fixed expense", () => {
    expect(normalizeEndMonth("committed", { year: 2027, month: 3 })).toEqual({
      year: 2027,
      month: 3,
    });
  });

  it("#69 rejects a last payment month on an estimated fixed expense", () => {
    expect(() => normalizeEndMonth("estimated", { year: 2027, month: 3 })).toThrow(
      EndMonthOnEstimatedError,
    );
  });

  it("#69 rejects out-of-range and non-integer values", () => {
    for (const bad of [
      { year: 2027, month: 13 },
      { year: 2027, month: 0 },
      { year: 1969, month: 5 },
      { year: 10000, month: 5 },
      { year: 2027.5, month: 5 },
      { year: 2027, month: 1.5 },
    ]) {
      expect(() => normalizeEndMonth("committed", bad)).toThrow(InvalidEndMonthError);
    }
  });
});

describe("isCopiedInto / hasEndedBy", () => {
  const end = { year: 2027, month: 3 };

  it("no last payment month: always copied, never ended", () => {
    expect(isCopiedInto(null, { year: 2099, month: 12 })).toBe(true);
    expect(hasEndedBy(null, { year: 2099, month: 12 })).toBe(false);
  });

  it("before the last payment month: copied, not ended", () => {
    expect(isCopiedInto(end, { year: 2027, month: 2 })).toBe(true);
    expect(hasEndedBy(end, { year: 2027, month: 2 })).toBe(false);
    expect(isCopiedInto(end, { year: 2026, month: 12 })).toBe(true);
    expect(hasEndedBy(end, { year: 2026, month: 12 })).toBe(false);
  });

  it("the last payment month itself: copied AND ended", () => {
    expect(isCopiedInto(end, { year: 2027, month: 3 })).toBe(true);
    expect(hasEndedBy(end, { year: 2027, month: 3 })).toBe(true);
  });

  it("after the last payment month: not copied, ended", () => {
    expect(isCopiedInto(end, { year: 2027, month: 4 })).toBe(false);
    expect(hasEndedBy(end, { year: 2027, month: 4 })).toBe(true);
    expect(isCopiedInto(end, { year: 2028, month: 1 })).toBe(false);
    expect(hasEndedBy(end, { year: 2028, month: 1 })).toBe(true);
  });
});
