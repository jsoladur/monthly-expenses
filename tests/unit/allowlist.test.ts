import { describe, expect, it } from "vitest";
import { isAllowlisted, normalizeEmail, parseAllowlist } from "@/server/auth/allowlist";

// ============================================================================
// Allowlist normalization (UC-01, PRD §5.2, ARCH §3.2 rule 1).
//
// The `signIn` callback runs `parseAllowlist(process.env.ALLOWED_EMAILS)`
// once and then asks `isAllowlisted(profile.email, allowlist)` for each
// Google sign-in attempt. Both sides MUST normalize trim + lowercase or the
// app would silently deny an email that the operator typed with spaces or
// mixed case.
// ============================================================================

describe("normalizeEmail", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alice@example.com  ")).toBe("alice@example.com");
  });

  it("lowercases the local and domain parts", () => {
    expect(normalizeEmail("Alice@Example.COM")).toBe("alice@example.com");
  });

  it("preserves non-letter characters", () => {
    expect(normalizeEmail("a.li+ce-1@sub.example.co.uk")).toBe(
      "a.li+ce-1@sub.example.co.uk",
    );
  });

  it("returns an empty string when given an empty string", () => {
    expect(normalizeEmail("")).toBe("");
    expect(normalizeEmail("   ")).toBe("");
  });
});

describe("parseAllowlist", () => {
  it("returns an empty set for undefined / null / empty input", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist(null).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
  });

  it("splits on commas, trims, and lowercases each entry", () => {
    const set = parseAllowlist(" Alice@Example.com , bob@example.com ");
    expect(set.size).toBe(2);
    expect(set.has("alice@example.com")).toBe(true);
    expect(set.has("bob@example.com")).toBe(true);
  });

  it("drops empty entries between commas", () => {
    const set = parseAllowlist("a@x.com,,b@x.com,");
    expect([...set].sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("deduplicates entries that normalize to the same value", () => {
    const set = parseAllowlist("alice@example.com,ALICE@EXAMPLE.com");
    expect(set.size).toBe(1);
    expect(set.has("alice@example.com")).toBe(true);
  });
});

describe("isAllowlisted", () => {
  const set = parseAllowlist("alice@example.com, bob@example.com");

  it("matches an exact allowlisted email", () => {
    expect(isAllowlisted("alice@example.com", set)).toBe(true);
  });

  it("matches regardless of casing and surrounding whitespace", () => {
    expect(isAllowlisted("  Alice@Example.COM ", set)).toBe(true);
  });

  it("rejects emails that are not on the allowlist", () => {
    expect(isAllowlisted("eve@example.com", set)).toBe(false);
  });

  it("rejects null / undefined / empty input", () => {
    expect(isAllowlisted(null, set)).toBe(false);
    expect(isAllowlisted(undefined, set)).toBe(false);
    expect(isAllowlisted("", set)).toBe(false);
    expect(isAllowlisted("   ", set)).toBe(false);
  });

  it("never matches against an empty allowlist", () => {
    expect(isAllowlisted("alice@example.com", parseAllowlist(""))).toBe(false);
    expect(isAllowlisted("alice@example.com", parseAllowlist(undefined))).toBe(false);
  });
});
