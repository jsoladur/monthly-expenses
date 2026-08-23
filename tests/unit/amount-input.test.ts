import { describe, expect, it } from "vitest";
import { classifyAmount } from "@/components/amount-input-helpers";

// ============================================================================
// AmountInput classifier (UC-02, PRD C9, PRD §11).
//
// The wire format is `^-?\d{1,12}\.\d{2}$`. `classifyAmount` distinguishes
// "still typing" from "wrong forever" so the UI doesn't shout errors mid-
// edit.
// ============================================================================

describe("classifyAmount", () => {
  describe("ok", () => {
    it.each(["0.00", "0.99", "1.00", "1234.56", "-20.00", "999999999999.99"])(
      "accepts canonical amount %s",
      (value) => {
        expect(classifyAmount(value, false)).toBe("ok");
        expect(classifyAmount(value, true)).toBe("ok");
      },
    );

    it("accepts empty when not required", () => {
      expect(classifyAmount("", false)).toBe("ok");
    });
  });

  describe("incomplete", () => {
    it("flags empty as incomplete when required", () => {
      expect(classifyAmount("", true)).toBe("incomplete");
    });

    it.each(["1", "1234.", "1234.5", "-20.", "-0.0"])(
      "flags partial typing as incomplete: %s",
      (value) => {
        expect(classifyAmount(value, false)).toBe("incomplete");
      },
    );
  });

  describe("invalid (rejected in BOTH locales, PRD C9 / §11)", () => {
    it("rejects comma decimals (`1234,56`) regardless of locale", () => {
      expect(classifyAmount("1234,56", false)).toBe("invalid");
      expect(classifyAmount("1234,56", true)).toBe("invalid");
    });

    it.each(["1234.567", "1234..56", "abc", " 1234.56", "1234.56 "])(
      "rejects %s",
      (value) => {
        expect(classifyAmount(value, false)).toBe("invalid");
      },
    );

    it("rejects values longer than 12 integer digits", () => {
      expect(classifyAmount("1234567890123.00", false)).toBe("invalid");
    });
  });
});
