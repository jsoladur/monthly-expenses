"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@/server/validators";
import { requireWorkspaceAccess } from "@/server/auth/require-workspace-access";
import { WorkspaceForbiddenError, WorkspaceNotFoundError } from "@/lib/workspace-roles";
import {
  PrivateWorkspaceNotTransferableError,
  TransferAlreadyPendingError,
  TransferNoLongerValidError,
  TransferNotFoundError,
  TransferTargetNotAllowedError,
  TransferTargetNotMemberError,
  TransferToSelfError,
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  declineOwnershipTransfer,
  proposeOwnershipTransfer,
} from "@/server/services/workspace-transfer";

// ============================================================================
// Ownership transfer server actions (UC-32 §4.3).
//
// Thin: Zod → `requireWorkspaceAccess(workspaceId)` (session + membership;
// non-members get not-found) → service (Owner-only checks, recipient checks)
// → `revalidatePath('/[locale]', 'layout')`. Error codes match `validation.*`.
// ============================================================================

export type TransferActionError =
  | "validation"
  | "workspaceNotFound"
  | "workspaceForbidden"
  | "transferTargetNotMember"
  | "transferTargetNotAllowed"
  | "transferToSelf"
  | "transferAlreadyPending"
  | "transferNotFound"
  | "transferNoLongerValid"
  | "privateWorkspaceNotTransferable";

export type TransferActionResult = { ok: true } | { ok: false; error: TransferActionError };

function toError(err: unknown): TransferActionError | null {
  if (err instanceof WorkspaceNotFoundError) return "workspaceNotFound";
  if (err instanceof WorkspaceForbiddenError) return "workspaceForbidden";
  if (err instanceof TransferTargetNotMemberError) return "transferTargetNotMember";
  if (err instanceof TransferTargetNotAllowedError) return "transferTargetNotAllowed";
  if (err instanceof TransferToSelfError) return "transferToSelf";
  if (err instanceof TransferAlreadyPendingError) return "transferAlreadyPending";
  if (err instanceof TransferNotFoundError) return "transferNotFound";
  if (err instanceof TransferNoLongerValidError) return "transferNoLongerValid";
  if (err instanceof PrivateWorkspaceNotTransferableError) return "privateWorkspaceNotTransferable";
  return null;
}

const workspaceSchema = z.object({ workspaceId: uuidSchema });
const proposeSchema = z.object({ workspaceId: uuidSchema, toUserId: uuidSchema });

async function run(
  workspaceId: string,
  fn: (access: Awaited<ReturnType<typeof requireWorkspaceAccess>>) => Promise<void>,
): Promise<TransferActionResult> {
  const locale = await getLocaleFromHeaders();
  try {
    const access = await requireWorkspaceAccess(workspaceId, "read", locale);
    await fn(access);
  } catch (err) {
    const code = toError(err);
    if (code) {
      // An invalid offer was removed on the server; refresh so it disappears.
      if (code === "transferNoLongerValid") revalidatePath("/[locale]", "layout");
      return { ok: false, error: code };
    }
    throw err;
  }
  revalidatePath("/[locale]", "layout");
  return { ok: true };
}

export async function proposeOwnershipTransferAction(input: {
  workspaceId: string;
  toUserId: string;
}): Promise<TransferActionResult> {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  return run(parsed.data.workspaceId, (access) =>
    proposeOwnershipTransfer(access, { toUserId: parsed.data.toUserId }),
  );
}

export async function cancelOwnershipTransferAction(input: {
  workspaceId: string;
}): Promise<TransferActionResult> {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  return run(parsed.data.workspaceId, (access) => cancelOwnershipTransfer(access));
}

export async function acceptOwnershipTransferAction(input: {
  workspaceId: string;
}): Promise<TransferActionResult> {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  return run(parsed.data.workspaceId, (access) => acceptOwnershipTransfer(access));
}

export async function declineOwnershipTransferAction(input: {
  workspaceId: string;
}): Promise<TransferActionResult> {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  return run(parsed.data.workspaceId, (access) => declineOwnershipTransfer(access));
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
