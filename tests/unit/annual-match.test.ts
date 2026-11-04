import { describe, expect, it } from "vitest";
import {
  findAnnualMatch,
  type AnnualMatchCandidate,
} from "@/lib/annual-match";

// UC-28 (proposed PRD §15 #62–#64) — pure match rules.

const TRANSPORT = "cat-transport";
const HOUSING = "cat-housing";

const reserved = (name: string, categoryId: string, amountCents = 45000): AnnualMatchCandidate => ({
  source: "reserved",
  categoryId,
  name,
  amountCents,
});
const actual = (name: string, categoryId: string, amountCents = 45000): AnnualMatchCandidate => ({
  source: "actual",
  categoryId,
  name,
  amountCents,
});

describe("findAnnualMatch (UC-28)", () => {
  it("#62 matches a reserved line in the same category whose name starts with the annual's", () => {
    const match = findAnnualMatch(
      { categoryId: TRANSPORT, name: "Car insurance" },
      [reserved("Car insurance 2026", TRANSPORT, 41250)],
    );
    expect(match).toEqual({ source: "reserved", name: "Car insurance 2026", amountCents: 41250 });
  });

  it("#63 same name in a different category is not a match", () => {
    expect(
      findAnnualMatch({ categoryId: TRANSPORT, name: "Car insurance" }, [
        reserved("Car insurance", HOUSING),
        actual("Car insurance", HOUSING),
      ]),
    ).toBeNull();
  });

  it("#64 folds accents, case and spaces: 'Seguro hogar' matches 'SEGURO HOGAR mapfre'", () => {
    expect(
      findAnnualMatch({ categoryId: HOUSING, name: "Séguro  hogar " }, [
        actual("SEGURO HOGAR mapfre", HOUSING, 21000),
      ]),
    ).toEqual({ source: "actual", name: "SEGURO HOGAR mapfre", amountCents: 21000 });
  });

  it("does not match when the annual name only appears mid-string", () => {
    expect(
      findAnnualMatch({ categoryId: HOUSING, name: "hogar" }, [actual("Seguro hogar", HOUSING)]),
    ).toBeNull();
  });

  it("prefers reserved lines over actuals, then name order", () => {
    const match = findAnnualMatch({ categoryId: TRANSPORT, name: "car" }, [
      actual("Car A", TRANSPORT, 1),
      reserved("Car Z", TRANSPORT, 2),
      reserved("Car B", TRANSPORT, 3),
    ]);
    expect(match).toEqual({ source: "reserved", name: "Car B", amountCents: 3 });
  });

  it("no candidates → null", () => {
    expect(findAnnualMatch({ categoryId: TRANSPORT, name: "Car" }, [])).toBeNull();
  });
});
