import { describe, expect, it } from "vitest";
import {
  hasMoveTargets,
  isMoveTargetAllowed,
  splitMoveTargets,
} from "@/lib/move-window";

// ============================================================================
// UC-26 move window (proposed PRD §15 #53–#55).
// ============================================================================

const m = (year: number, month: number) => ({ year, month });

describe("isMoveTargetAllowed", () => {
  it("allows the next month (#52: Nov 2026 → Dec 2026)", () => {
    expect(isMoveTargetAllowed(m(2026, 11), m(2026, 12))).toBe(true);
  });

  it("allows any later month across years (#54: Nov 2026 → Jan 2028)", () => {
    expect(isMoveTargetAllowed(m(2026, 11), m(2028, 1))).toBe(true);
    expect(isMoveTargetAllowed(m(2026, 12), m(2027, 1))).toBe(true);
  });

  it("allows up to 3 months back across years (#53)", () => {
    const feb2027 = m(2027, 2);
    expect(isMoveTargetAllowed(feb2027, m(2027, 1))).toBe(true);
    expect(isMoveTargetAllowed(feb2027, m(2026, 12))).toBe(true);
    expect(isMoveTargetAllowed(feb2027, m(2026, 11))).toBe(true);
  });

  it("rejects 4+ months back (#53: Feb 2027 → Oct 2026)", () => {
    expect(isMoveTargetAllowed(m(2027, 2), m(2026, 10))).toBe(false);
    expect(isMoveTargetAllowed(m(2027, 2), m(2025, 2))).toBe(false);
  });

  it("rejects the same month (#55)", () => {
    expect(isMoveTargetAllowed(m(2026, 11), m(2026, 11))).toBe(false);
  });
});

describe("splitMoveTargets", () => {
  it("groups previous newest-first (≤ 3) and upcoming oldest-first", () => {
    const months = [
      m(2026, 10),
      m(2028, 1),
      m(2026, 11),
      m(2027, 3),
      m(2027, 2),
      m(2026, 12),
      m(2027, 1),
    ];
    const targets = splitMoveTargets(m(2027, 2), months);
    expect(targets.previous).toEqual([m(2027, 1), m(2026, 12), m(2026, 11)]);
    expect(targets.upcoming).toEqual([m(2027, 3), m(2028, 1)]);
  });

  it("keeps extra fields of the input rows", () => {
    const targets = splitMoveTargets(m(2026, 11), [{ id: "x", year: 2026, month: 12 }]);
    expect(targets.upcoming[0]!.id).toBe("x");
  });

  it("returns nothing when no created month is in the window (#55)", () => {
    const targets = splitMoveTargets(m(2026, 11), [m(2026, 11), m(2026, 6)]);
    expect(targets).toEqual({ previous: [], upcoming: [] });
    expect(hasMoveTargets(targets)).toBe(false);
  });
});
