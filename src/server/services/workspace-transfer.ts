import "server-only";
import { db } from "@/server/db/client";
import type { Tx } from "@/server/repositories/user";
import * as workspaceRepo from "@/server/repositories/workspace";
import {
  deleteOffer,
  findOfferForWorkspace,
  findOffersForRecipient,
  findUserLabels,
  insertOffer,
  lockWorkspace,
  type OfferRow,
} from "@/server/repositories/workspace-transfer";
import { parseAllowlist } from "@/server/auth/allowlist";
import { authorize, WorkspaceNotFoundError, type WorkspaceAccess } from "@/lib/workspace-roles";
import { offerProblem, type OfferProblem } from "@/lib/workspace-transfer-rules";

// ============================================================================
// Workspace ownership transfer service (UC-32, PRD UC-34 / C32).
//
// The Owner offers a shared workspace to one current member; nothing changes
// until that member accepts. Accept runs in one transaction: lock the
// workspace, re-check the offer, demote the Owner to Admin, promote the
// target, delete the offer (demote BEFORE promote, so "one Owner per
// workspace" holds at every instant). No data changes (§2 rule 11).
// ============================================================================

export class TransferTargetNotMemberError extends Error {
  readonly code = "transfer_target_not_member" as const;
  constructor() {
    super("Ownership can only go to a current member");
    this.name = "TransferTargetNotMemberError";
  }
}

export class TransferTargetNotAllowedError extends Error {
  readonly code = "transfer_target_not_allowed" as const;
  constructor() {
    super("That person is no longer on the allowlist");
    this.name = "TransferTargetNotAllowedError";
  }
}

export class TransferToSelfError extends Error {
  readonly code = "transfer_to_self" as const;
  constructor() {
    super("You already own this workspace");
    this.name = "TransferToSelfError";
  }
}

export class TransferAlreadyPendingError extends Error {
  readonly code = "transfer_already_pending" as const;
  constructor() {
    super("An ownership offer is already waiting for an answer");
    this.name = "TransferAlreadyPendingError";
  }
}

/** No offer addressed to the caller (also the answer for non-recipients). */
export class TransferNotFoundError extends Error {
  readonly code = "transfer_not_found" as const;
  constructor() {
    super("Ownership offer not found");
    this.name = "TransferNotFoundError";
  }
}

export class TransferNoLongerValidError extends Error {
  readonly code = "transfer_no_longer_valid" as const;
  constructor(readonly problem: OfferProblem) {
    super(`Ownership offer is no longer valid (${problem})`);
    this.name = "TransferNoLongerValidError";
  }
}

export class PrivateWorkspaceNotTransferableError extends Error {
  readonly code = "private_workspace_not_transferable" as const;
  constructor() {
    super("A private workspace cannot be transferred");
    this.name = "PrivateWorkspaceNotTransferableError";
  }
}

function envAllowlist(): ReadonlySet<string> {
  return parseAllowlist(process.env.ALLOWED_EMAILS);
}

/** Re-check an offer against the CURRENT memberships, kind and allowlist. */
async function problemWith(
  offer: OfferRow,
  allowlist: ReadonlySet<string>,
  tx: Tx | typeof db,
): Promise<OfferProblem | null> {
  const [ws, proposer, target, labels] = await Promise.all([
    workspaceRepo.findWorkspaceById(offer.workspaceId, tx),
    workspaceRepo.findMembership(offer.workspaceId, offer.fromUserId, tx),
    workspaceRepo.findMembership(offer.workspaceId, offer.toUserId, tx),
    findUserLabels([offer.toUserId], tx),
  ]);
  if (!ws) return "privateWorkspace";
  return offerProblem({
    workspaceKind: ws.kind,
    proposerRole: proposer?.role ?? null,
    targetRole: target?.role ?? null,
    targetEmail: labels.get(offer.toUserId)?.email ?? "",
    allowlist,
  });
}

// ----------------------------------------------------------------------------
// Owner: propose / cancel
// ----------------------------------------------------------------------------

export async function proposeOwnershipTransfer(
  access: WorkspaceAccess,
  input: { toUserId: string },
  allowlist: ReadonlySet<string> = envAllowlist(),
): Promise<void> {
  const workspaceId = authorize(access, "transferOwnership");
  if (access.kind !== "shared") throw new PrivateWorkspaceNotTransferableError();
  if (input.toUserId === access.userId) throw new TransferToSelfError();

  const target = workspaceRepo.isUuid(input.toUserId)
    ? await workspaceRepo.findMembership(workspaceId, input.toUserId)
    : null;
  if (!target) throw new TransferTargetNotMemberError();
  const labels = await findUserLabels([input.toUserId]);
  const problem = offerProblem({
    workspaceKind: access.kind,
    proposerRole: access.role,
    targetRole: target.role,
    targetEmail: labels.get(input.toUserId)?.email ?? "",
    allowlist,
  });
  if (problem === "targetNotAllowed") throw new TransferTargetNotAllowedError();
  if (problem === "targetIsOwner") throw new TransferToSelfError();
  if (problem) throw new TransferTargetNotMemberError();

  if (await findOfferForWorkspace(workspaceId)) throw new TransferAlreadyPendingError();
  try {
    await insertOffer(workspaceId, access.userId, input.toUserId);
  } catch (err) {
    if (isUniqueViolation(err)) throw new TransferAlreadyPendingError();
    throw err;
  }
}

export async function cancelOwnershipTransfer(access: WorkspaceAccess): Promise<void> {
  const workspaceId = authorize(access, "transferOwnership");
  if (!(await deleteOffer(workspaceId))) throw new TransferNotFoundError();
}

// ----------------------------------------------------------------------------
// Recipient: decline / accept (any member; only the addressee finds an offer)
// ----------------------------------------------------------------------------

export async function declineOwnershipTransfer(access: WorkspaceAccess): Promise<void> {
  const workspaceId = authorize(access, "read");
  const offer = await findOfferForWorkspace(workspaceId);
  if (!offer || offer.toUserId !== access.userId) throw new TransferNotFoundError();
  await deleteOffer(workspaceId);
}

export async function acceptOwnershipTransfer(
  access: WorkspaceAccess,
  allowlist: ReadonlySet<string> = envAllowlist(),
): Promise<void> {
  const workspaceId = authorize(access, "read");
  // An invalid offer is deleted (and committed) BEFORE the error is thrown,
  // so the stale offer never comes back (§2 rule 6.2).
  const outcome = await db.transaction(async (tx): Promise<OfferProblem | null> => {
    await lockWorkspace(workspaceId, tx);
    const offer = await findOfferForWorkspace(workspaceId, tx);
    if (!offer || offer.toUserId !== access.userId) throw new TransferNotFoundError();
    const problem = await problemWith(offer, allowlist, tx);
    if (problem) {
      await deleteOffer(workspaceId, tx);
      return problem;
    }
    await workspaceRepo.updateMemberRole(workspaceId, offer.fromUserId, "admin", tx);
    await workspaceRepo.updateMemberRole(workspaceId, offer.toUserId, "owner", tx);
    await deleteOffer(workspaceId, tx);
    return null;
  });
  if (outcome) throw new TransferNoLongerValidError(outcome);
}

// ----------------------------------------------------------------------------
// Reads (drop invalid offers first, so the UI never shows a stale one)
// ----------------------------------------------------------------------------

export interface WorkspaceOffer {
  fromUserId: string;
  fromLabel: string;
  toUserId: string;
  toLabel: string;
  createdAt: Date;
}

/**
 * The pending offer of this workspace, as seen by its Owner or its addressee.
 * `null` for anyone else, when there is none, or when it is no longer valid
 * (it is deleted then).
 */
export async function getOfferForWorkspace(
  access: WorkspaceAccess,
  allowlist: ReadonlySet<string> = envAllowlist(),
): Promise<WorkspaceOffer | null> {
  const workspaceId = authorize(access, "read");
  const offer = await findOfferForWorkspace(workspaceId);
  if (!offer) return null;
  if (offer.fromUserId !== access.userId && offer.toUserId !== access.userId && access.role !== "owner") {
    return null;
  }
  if (await problemWith(offer, allowlist, db)) {
    await deleteOffer(workspaceId);
    return null;
  }
  const labels = await findUserLabels([offer.fromUserId, offer.toUserId]);
  return {
    fromUserId: offer.fromUserId,
    fromLabel: labels.get(offer.fromUserId)?.label ?? "",
    toUserId: offer.toUserId,
    toLabel: labels.get(offer.toUserId)?.label ?? "",
    createdAt: offer.createdAt,
  };
}

export interface IncomingOffer {
  workspaceId: string;
  workspaceName: string;
  fromLabel: string;
}

/** Offers addressed to the session user, across workspaces (identity-keyed). */
export async function listOffersForUser(
  userId: string,
  allowlist: ReadonlySet<string> = envAllowlist(),
): Promise<IncomingOffer[]> {
  const offers = await findOffersForRecipient(userId);
  const valid: (typeof offers)[number][] = [];
  for (const offer of offers) {
    if (await problemWith(offer, allowlist, db)) await deleteOffer(offer.workspaceId);
    else valid.push(offer);
  }
  const labels = await findUserLabels(valid.map((o) => o.fromUserId));
  return valid.map((o) => ({
    workspaceId: o.workspaceId,
    workspaceName: o.workspaceName ?? "",
    fromLabel: labels.get(o.fromUserId)?.label ?? "",
  }));
}

export { WorkspaceNotFoundError };

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
