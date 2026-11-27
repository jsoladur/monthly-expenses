import { normalizeEmail } from "@/server/auth/allowlist";
import type { WorkspaceKind, WorkspaceRole } from "@/lib/workspace-roles";

// ============================================================================
// UC-32 — is an ownership offer still valid? (§2 rules 1, 3, 6.2, 8)
//
// Pure, shared by `listOffersForUser` (which drops invalid offers before the
// UI sees them) and `acceptOwnershipTransfer` (which re-checks inside its
// transaction). `null` = valid; otherwise the reason it is not.
// ============================================================================

export type OfferProblem =
  | "privateWorkspace"
  | "proposerNotOwner"
  | "targetNotMember"
  | "targetIsOwner"
  | "targetNotAllowed";

export function offerProblem(input: {
  workspaceKind: WorkspaceKind;
  /** The proposer's CURRENT role in the workspace, or null if they left. */
  proposerRole: WorkspaceRole | null;
  /** The target's CURRENT role in the workspace, or null if not a member. */
  targetRole: WorkspaceRole | null;
  targetEmail: string;
  allowlist: ReadonlySet<string>;
}): OfferProblem | null {
  if (input.workspaceKind !== "shared") return "privateWorkspace";
  if (input.proposerRole !== "owner") return "proposerNotOwner";
  if (input.targetRole === null) return "targetNotMember";
  if (input.targetRole === "owner") return "targetIsOwner";
  if (!input.allowlist.has(normalizeEmail(input.targetEmail))) return "targetNotAllowed";
  return null;
}
