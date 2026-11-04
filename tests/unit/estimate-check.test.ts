import { describe, expect, it } from "vitest";
import {
  computeEstimateCheck,
  isBeforeCurrentMonth,
  planEstimateUpdates,
  type EstimateLineInput,
  type TicketInput,
} from "@/lib/estimate-check";

// ============================================================================
// UC-25 estimate check — pure math (proposed PRD §15 #47–#49).
// ============================================================================

const line = (
  id: string,
  name: string,
  original: number,
  remaining: number,
  categoryId = "groceries",
): EstimateLineInput => ({
  id,
  categoryId,
  categoryName: categoryId === "groceries" ? "Groceries" : categoryId,
  name,
  originalCents: original,
  remainingCents: remaining,
});

let ticketSeq = 0;
const tk = (categoryId: string, amountCents: number, fromLine = false): TicketInput => ({
  id: `t${++ticketSeq}`,
  categoryId,
  name: fromLine ? "Passed line" : "Ticket",
  amountCents,
  fromLine,
});

describe("computeEstimateCheck", () => {
  it("#47 plan 400, remaining 400, tickets 120 → flagged, suggested 280", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 40_000)],
      [tk("groceries", 12_000)],
    );
    expect(check.categories).toEqual([
      {
        categoryId: "groceries",
        categoryName: "Groceries",
        plan: 40_000,
        remaining: 40_000,
        tickets: 12_000,
        suggested: 28_000,
        flagged: true,
        lines: [{ id: "a", name: "Groceries", remaining: 40_000 }],
        ticketList: [expect.objectContaining({ amount: 12_000, counted: true })],
      },
    ]);
    expect(check.releasableTotal).toBe(12_000);
  });

  it("is not flagged once the envelope was lowered by hand", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 28_000)],
      [tk("groceries", 12_000)],
    );
    expect(check.categories[0]!.flagged).toBe(false);
    expect(check.releasableTotal).toBe(0);
  });

  it("clamps suggested at 0 when tickets exceed the plan", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 10_000, 10_000)],
      [tk("groceries", 15_000)],
    );
    expect(check.categories[0]!.suggested).toBe(0);
    expect(check.categories[0]!.flagged).toBe(true);
  });

  it("follows the algebra for negative tickets (refunds raise suggested)", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 10_000, 10_000)],
      [tk("groceries", -2_000)],
    );
    expect(check.categories[0]!.suggested).toBe(12_000);
    expect(check.categories[0]!.flagged).toBe(false);
  });

  it("does not count tickets created by pass-to-actual (their line already left the plan)", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 40_000)],
      [tk("groceries", 50_000, true)],
    );
    const [cat] = check.categories;
    expect(cat!.tickets).toBe(0);
    expect(cat!.flagged).toBe(false);
    expect(cat!.ticketList).toEqual([
      expect.objectContaining({ amount: 50_000, counted: false }),
    ]);
  });

  it("lists counted tickets first, largest first, then passed ones", () => {
    const [cat] = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 40_000)],
      [tk("groceries", 1_000), tk("groceries", 9_000, true), tk("groceries", 5_000)],
    ).categories;
    expect(cat!.ticketList.map((t) => [t.amount, t.counted])).toEqual([
      [5_000, true],
      [1_000, true],
      [9_000, false],
    ]);
    expect(cat!.tickets).toBe(6_000);
  });

  it("ignores tickets in categories without estimated lines", () => {
    const check = computeEstimateCheck(
      [line("a", "Groceries", 10_000, 10_000)],
      [tk("fuel", 5_000)],
    );
    expect(check.categories.map((c) => c.categoryId)).toEqual(["groceries"]);
    expect(check.categories[0]!.tickets).toBe(0);
  });

  it("lists flagged categories first, then by name", () => {
    const check = computeEstimateCheck(
      [line("a", "Bus", 5_000, 5_000, "transport"), line("b", "Food", 5_000, 5_000, "food")],
      [tk("transport", 1_000)],
    );
    expect(check.categories.map((c) => c.categoryId)).toEqual(["transport", "food"]);
  });
});

describe("planEstimateUpdates", () => {
  it("#47 single line gets suggested", () => {
    const [cat] = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 40_000)],
      [tk("groceries", 12_000)],
    ).categories;
    expect(planEstimateUpdates(cat!, "suggested")).toEqual([{ id: "a", remaining: 28_000 }]);
  });

  it("#48 distributes suggested in name order; later lines go to 0", () => {
    const [cat] = computeEstimateCheck(
      [line("g", "Groceries", 30_000, 30_000), line("e", "Extra", 10_000, 10_000)],
      [tk("groceries", 35_000)],
    ).categories;
    expect(cat!.suggested).toBe(5_000);
    expect(planEstimateUpdates(cat!, "suggested")).toEqual([
      { id: "e", remaining: 5_000 },
      { id: "g", remaining: 0 },
    ]);
  });

  it("never raises a line above its current remaining", () => {
    const updates = planEstimateUpdates(
      {
        suggested: 30_000,
        lines: [
          { id: "a", name: "A", remaining: 5_000 },
          { id: "b", name: "B", remaining: 40_000 },
        ],
      },
      "suggested",
    );
    expect(updates).toEqual([{ id: "b", remaining: 25_000 }]);
  });

  it("#49 release sets every line to 0 and skips lines already at 0", () => {
    const updates = planEstimateUpdates(
      {
        suggested: 10_000,
        lines: [
          { id: "a", name: "A", remaining: 5_000 },
          { id: "b", name: "B", remaining: 0 },
          { id: "c", name: "C", remaining: -1_000 },
        ],
      },
      "release",
    );
    expect(updates).toEqual([
      { id: "a", remaining: 0 },
      { id: "c", remaining: 0 },
    ]);
  });

  it("is a no-op when nothing is flagged", () => {
    const [cat] = computeEstimateCheck(
      [line("a", "Groceries", 40_000, 28_000)],
      [tk("groceries", 12_000)],
    ).categories;
    expect(planEstimateUpdates(cat!, "suggested")).toEqual([]);
  });
});

describe("isBeforeCurrentMonth", () => {
  const now = new Date(Date.UTC(2026, 10, 4)); // Nov 2026
  it.each([
    [2026, 10, true],
    [2025, 12, true],
    [2026, 11, false],
    [2026, 12, false],
    [2027, 1, false],
  ])("%i-%i → %s", (year, month, expected) => {
    expect(isBeforeCurrentMonth(year, month, now)).toBe(expected);
  });
});
