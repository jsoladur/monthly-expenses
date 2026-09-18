import { describe, expect, it } from "vitest";
import { buildCategoryBreakdowns } from "@/app/[locale]/months/[year]/[month]/stats-category-types";

describe("buildCategoryBreakdowns", () => {
  it("splits one category into actuals, estimated, and committed", () => {
    const result = buildCategoryBreakdowns(
      [
        {
          id: "a1",
          categoryId: "food",
          categoryName: "Groceries",
          name: "Bread",
          amountCents: 50_00,
          observations: null,
        },
      ],
      [
        {
          id: "e1",
          categoryId: "food",
          categoryName: "Groceries",
          name: "Envelope",
          remainingCents: 400_00,
          kind: "estimated",
          observations: null,
        },
        {
          id: "c1",
          categoryId: "food",
          categoryName: "Groceries",
          name: "Mortgage",
          remainingCents: 800_00,
          kind: "committed",
          observations: null,
        },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      categoryId: "food",
      name: "Groceries",
      value: 1_250_00,
    });
    expect(result[0]!.actuals.map((l) => l.name)).toEqual(["Bread"]);
    expect(result[0]!.estimated.map((l) => l.name)).toEqual(["Envelope"]);
    expect(result[0]!.committed.map((l) => l.name)).toEqual(["Mortgage"]);
  });

  it("keeps categories isolated and sorts by total desc", () => {
    const result = buildCategoryBreakdowns(
      [
        {
          id: "a1",
          categoryId: "b",
          categoryName: "Bills",
          name: "Power",
          amountCents: 10_00,
          observations: null,
        },
      ],
      [
        {
          id: "e1",
          categoryId: "a",
          categoryName: "Auto",
          name: "Fuel",
          remainingCents: 90_00,
          kind: "estimated",
          observations: null,
        },
      ],
    );

    expect(result.map((c) => c.name)).toEqual(["Auto", "Bills"]);
    expect(result[0]!.actuals).toHaveLength(0);
    expect(result[1]!.estimated).toHaveLength(0);
  });
});
