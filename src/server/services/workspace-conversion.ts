import "server-only";
import { db } from "@/server/db/client";
import * as workspaceRepo from "@/server/repositories/workspace";
import type { InvitationRow, MemberRow, WorkspaceCounts } from "@/server/repositories/workspace";
import { getProfileSettings, updateCurrency } from "@/server/repositories/profile-settings";
import { deleteOffer } from "@/server/repositories/workspace-transfer";
import {
  WorkspaceForbiddenError,
  WorkspaceNotFoundError,
  authorize,
  type WorkspaceAccess,
} from "@/lib/workspace-roles";
import { matchesWorkspaceName } from "@/lib/workspace-name";
import {
  PrivateWorkspaceImmutableError,
  WorkspaceNameMismatchError,
  normalizeWorkspaceName,
} from "@/server/services/workspaces";

// ============================================================================
// Workspace conversion service (UC-33, PRD UC-35 / C33).
//
// Convert = change what a workspace IS, not where its rows live. No tenant row
// is copied or re-pointed: the `workspace` row is re-labelled and memberships
// adjusted, inside ONE transaction per operation (§2.4).
//
//   - shareMyPrivateWorkspace: private → shared (name it), then a fresh empty
//     private workspace for the caller, exactly as sign-in creates one.
//   - makeWorkspaceMyPrivate: shared → private of the caller, after deleting
//     the caller's current private workspace and every other member,
//     invitation and pending ownership offer.
//
// The typed confirmations are re-checked here: the server is the gate (§3).
// ============================================================================

/** UC-33 §2.1: sharing a workspace that is already shared. Maps to `workspaceForbidden`. */
export class WorkspaceAlreadySharedError extends Error {
  readonly code = "workspace_already_shared" as const;
  constructor() {
    super("This workspace is already shared");
    this.name = "WorkspaceAlreadySharedError";
  }
}

/** UC-33 §3.2 step 2: the data-loss checkbox was not ticked. Maps to `validation`. */
export class DataLossNotAcknowledgedError extends Error {
  readonly code = "data_loss_not_acknowledged" as const;
  constructor() {
    super("The data loss must be acknowledged");
    this.name = "DataLossNotAcknowledgedError";
  }
}

export type ConversionCounts = Omit<WorkspaceCounts, "members">;

function contentCounts(counts: WorkspaceCounts): ConversionCounts {
  const { months, categories, templates, annuals, actuals } = counts;
  return { months, categories, templates, annuals, actuals };
}

// ----------------------------------------------------------------------------
// Summaries for the confirmation steps (§3)
// ----------------------------------------------------------------------------

export interface ShareSummary {
  counts: ConversionCounts;
}

export async function getShareSummary(access: WorkspaceAccess): Promise<ShareSummary> {
  const workspaceId = authorize(access, "convertToShared");
  if (access.kind !== "private") throw new WorkspaceAlreadySharedError();
  return { counts: contentCounts(await workspaceRepo.countWorkspaceContents(workspaceId)) };
}

export interface MakePrivateSummary {
  sharedName: string;
  /** The caller's current private workspace (deleted on confirm); null if missing. */
  privateWorkspaceId: string | null;
  privateCounts: ConversionCounts;
  /** Everyone but the caller: they lose access. */
  members: MemberRow[];
  invitations: InvitationRow[];
}

export async function getMakePrivateSummary(access: WorkspaceAccess): Promise<MakePrivateSummary> {
  const workspaceId = authorize(access, "convertToPrivate");
  if (access.kind !== "shared") throw new PrivateWorkspaceImmutableError();
  const [found, priv, members, invitations] = await Promise.all([
    workspaceRepo.findWorkspaceById(workspaceId),
    workspaceRepo.findPrivateWorkspaceByUser(access.userId),
    workspaceRepo.listMembers(workspaceId),
    workspaceRepo.listInvitations(workspaceId),
  ]);
  if (!found) throw new WorkspaceNotFoundError();
  const privateCounts = priv
    ? contentCounts(await workspaceRepo.countWorkspaceContents(priv.id))
    : { months: 0, categories: 0, templates: 0, annuals: 0, actuals: 0 };
  return {
    sharedName: found.name ?? "",
    privateWorkspaceId: priv?.id ?? null,
    privateCounts,
    members: members.filter((m) => m.userId !== access.userId),
    invitations,
  };
}

// ----------------------------------------------------------------------------
// Share my private workspace (§2.2)
// ----------------------------------------------------------------------------

export async function shareMyPrivateWorkspace(
  access: WorkspaceAccess,
  input: { name: string; confirmName: string },
): Promise<{ workspaceId: string; privateWorkspaceId: string }> {
  const workspaceId = authorize(access, "convertToShared");
  if (access.kind !== "private") throw new WorkspaceAlreadySharedError();
  const name = normalizeWorkspaceName(input.name);
  if (!matchesWorkspaceName(input.confirmName, name)) throw new WorkspaceNameMismatchError();

  return db.transaction(async (tx) => {
    // Re-check under the row lock: a concurrent convert may have won.
    const locked = await workspaceRepo.lockWorkspace(workspaceId, tx);
    if (!locked) throw new WorkspaceNotFoundError();
    if (locked.kind !== "private") throw new WorkspaceAlreadySharedError();
    if (locked.personalUserId !== access.userId) throw new WorkspaceForbiddenError();

    // Order matters: freeing `personal_user_id` first lets the new private
    // workspace claim it (§2.2 step 4).
    const shared = await workspaceRepo.markShared(workspaceId, name, tx);
    if (!shared) throw new WorkspaceAlreadySharedError();
    const profile = await getProfileSettings(access.userId, tx);
    const fresh = await workspaceRepo.insertPrivateWorkspace(
      access.userId,
      profile?.currency ?? "EUR",
      tx,
    );
    return { workspaceId, privateWorkspaceId: fresh.id };
  });
}

// ----------------------------------------------------------------------------
// Make this shared workspace my private workspace (§2.3)
// ----------------------------------------------------------------------------

export async function makeWorkspaceMyPrivate(
  access: WorkspaceAccess,
  input: { confirmName: string; acknowledgeDataLoss: boolean },
): Promise<{ workspaceId: string; name: string }> {
  const workspaceId = authorize(access, "convertToPrivate");
  if (access.kind !== "shared") throw new PrivateWorkspaceImmutableError();
  if (input.acknowledgeDataLoss !== true) throw new DataLossNotAcknowledgedError();

  return db.transaction(async (tx) => {
    // Fixed lock order — private first, then shared — to avoid deadlocks.
    const priv = await workspaceRepo.findPrivateWorkspaceByUser(access.userId, tx);
    if (priv) await workspaceRepo.lockWorkspace(priv.id, tx);
    const shared = await workspaceRepo.lockWorkspace(workspaceId, tx);
    if (!shared) throw new WorkspaceNotFoundError();
    if (shared.kind !== "shared") throw new PrivateWorkspaceImmutableError();
    const membership = await workspaceRepo.findMembership(workspaceId, access.userId, tx);
    if (membership?.role !== "owner") throw new WorkspaceForbiddenError();
    const name = shared.name ?? "";
    if (!matchesWorkspaceName(input.confirmName, name)) throw new WorkspaceNameMismatchError();

    // 1. The current private workspace and everything in it.
    if (priv) await workspaceRepo.deleteWorkspaceCascade(priv.id, tx, { allowPrivate: true });
    // 2. Everyone else, pending invitations and the ownership offer (UC-32).
    await workspaceRepo.deleteOtherMembers(workspaceId, access.userId, tx);
    await workspaceRepo.deleteInvitationsOf(workspaceId, tx);
    await deleteOffer(workspaceId, tx);
    // 3. Re-label; ids and data stay.
    const updated = await workspaceRepo.markPrivate(workspaceId, access.userId, tx);
    if (!updated) throw new PrivateWorkspaceImmutableError();
    // 4. Private workspace currency and profile currency stay equal (UC-31 §4.2.4).
    await updateCurrency(access.userId, updated.currency, tx);
    return { workspaceId, name };
  });
}
