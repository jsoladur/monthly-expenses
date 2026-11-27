import { describe, expect, it } from "vitest";
import { offerProblem } from "@/lib/workspace-transfer-rules";

// ============================================================================
// UC-32 — the pure validity check shared by list and accept (§2 rules 1, 3, 8).
// `null` = the offer is valid; otherwise the reason it is not.
// ============================================================================

const ALLOW = new Set(["owner@example.com", "target@example.com"]);

const valid = {
  workspaceKind: "shared" as const,
  proposerRole: "owner" as const,
  targetRole: "editor" as const,
  targetEmail: "target@example.com",
  allowlist: ALLOW,
};

describe("UC-32 offerProblem()", () => {
  it("accepts an offer from the Owner to an allowlisted member of a shared workspace", () => {
    expect(offerProblem(valid)).toBeNull();
    expect(offerProblem({ ...valid, targetRole: "reader" })).toBeNull();
    expect(offerProblem({ ...valid, targetRole: "admin" })).toBeNull();
  });

  it("normalizes the target email like the allowlist (trim + lowercase)", () => {
    expect(offerProblem({ ...valid, targetEmail: "  Target@Example.com " })).toBeNull();
  });

  it("rejects a private workspace", () => {
    expect(offerProblem({ ...valid, workspaceKind: "private" })).toBe("privateWorkspace");
  });

  it("rejects when the proposer is no longer the Owner", () => {
    expect(offerProblem({ ...valid, proposerRole: "admin" })).toBe("proposerNotOwner");
    expect(offerProblem({ ...valid, proposerRole: null })).toBe("proposerNotOwner");
  });

  it("rejects a target who is not a member, or is the Owner", () => {
    expect(offerProblem({ ...valid, targetRole: null })).toBe("targetNotMember");
    expect(offerProblem({ ...valid, targetRole: "owner" })).toBe("targetIsOwner");
  });

  it("rejects a target whose email left the allowlist", () => {
    expect(offerProblem({ ...valid, targetEmail: "gone@example.com" })).toBe("targetNotAllowed");
  });
});
