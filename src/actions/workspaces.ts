"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currencySchema, uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  clearActiveWorkspaceCookieIf,
  requireWorkspaceAccess,
  setActiveWorkspaceCookie,
} from "@/server/auth/require-workspace-access";
import { clearLastOpenedMonthCookie } from "@/server/cookies/last-opened-month";
import {
  ASSIGNABLE_ROLES,
  WorkspaceForbiddenError,
  WorkspaceNotFoundError,
} from "@/lib/workspace-roles";
import {
  CannotRemoveOwnerError,
  InvalidWorkspaceCurrencyError,
  InvalidWorkspaceNameError,
  InvalidWorkspaceRoleError,
  OwnerCannotLeaveError,
  PrivateWorkspaceImmutableError,
  WORKSPACE_NAME_MAX,
  WorkspaceEmailNotAllowedError,
  WorkspaceMemberExistsError,
  WorkspaceInvitationExistsError,
  WorkspaceInvitationNotFoundError,
  WorkspaceMemberNotFoundError,
  WorkspaceNameMismatchError,
  addMember,
  cancelInvitation,
  changeInvitationRole,
  changeMemberRole,
  createSharedWorkspace,
  deleteWorkspace,
  leaveWorkspace,
  removeMember,
  renameWorkspace,
  setWorkspaceCurrency,
} from "@/server/services/workspaces";
import { redirect } from "@/i18n/navigation";

// ============================================================================
// Workspace server actions (UC-31 §5.5).
//
// Thin: Zod → `requireUserId()` (via `requireWorkspaceAccess` for actions on
// one workspace: membership, not-found for non-members) → service (role
// matrix) → `revalidatePath('/[locale]', 'layout')`. Domain errors become
// stable codes that match `validation.*` i18n keys.
// ============================================================================

export type WorkspaceActionError =
  | "validation"
  | "workspaceNotFound"
  | "workspaceForbidden"
  | "workspaceNameRequired"
  | "workspaceNameTooLong"
  | "currencyInvalid"
  | "workspaceEmailInvalid"
  | "workspaceEmailNotAllowed"
  | "workspaceInvitationExists"
  | "workspaceInvitationNotFound"
  | "workspaceMemberExists"
  | "workspaceMemberNotFound"
  | "cannotRemoveOwner"
  | "ownerCannotLeave"
  | "workspaceNameMismatch";

export type WorkspaceActionResult =
  | { ok: true }
  | { ok: false; error: WorkspaceActionError };

const roleSchema = z.enum(ASSIGNABLE_ROLES);
const nameSchema = z.string().max(WORKSPACE_NAME_MAX * 4);

function toError(err: unknown): WorkspaceActionError | null {
  if (err instanceof WorkspaceNotFoundError) return "workspaceNotFound";
  if (err instanceof WorkspaceForbiddenError) return "workspaceForbidden";
  if (err instanceof PrivateWorkspaceImmutableError) return "workspaceForbidden";
  if (err instanceof InvalidWorkspaceRoleError) return "workspaceForbidden";
  if (err instanceof InvalidWorkspaceNameError) {
    return err.reason === "required" ? "workspaceNameRequired" : "workspaceNameTooLong";
  }
  if (err instanceof InvalidWorkspaceCurrencyError) return "currencyInvalid";
  if (err instanceof WorkspaceEmailNotAllowedError) return "workspaceEmailNotAllowed";
  if (err instanceof WorkspaceInvitationExistsError) return "workspaceInvitationExists";
  if (err instanceof WorkspaceInvitationNotFoundError) return "workspaceInvitationNotFound";
  if (err instanceof WorkspaceMemberExistsError) return "workspaceMemberExists";
  if (err instanceof WorkspaceMemberNotFoundError) return "workspaceMemberNotFound";
  if (err instanceof CannotRemoveOwnerError) return "cannotRemoveOwner";
  if (err instanceof OwnerCannotLeaveError) return "ownerCannotLeave";
  if (err instanceof WorkspaceNameMismatchError) return "workspaceNameMismatch";
  return null;
}

async function run(fn: () => Promise<unknown>): Promise<WorkspaceActionResult> {
  try {
    await fn();
  } catch (err) {
    const code = toError(err);
    if (code) return { ok: false, error: code };
    throw err;
  }
  revalidatePath("/[locale]", "layout");
  return { ok: true };
}

// ----------------------------------------------------------------------------

// Currency is optional: when omitted, the service inherits the creator's
// profile currency (UC-31 §4.2).
const createSchema = z.object({ name: nameSchema, currency: currencySchema.optional() });

export type CreateWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: WorkspaceActionError };

export async function createSharedWorkspaceAction(input: {
  name: string;
  currency?: string;
}): Promise<CreateWorkspaceResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    const created = await createSharedWorkspace(userId, parsed.data);
    revalidatePath("/[locale]", "layout");
    return { ok: true, workspaceId: created.id };
  } catch (err) {
    const code = toError(err);
    if (code) return { ok: false, error: code };
    throw err;
  }
}

const renameSchema = z.object({ workspaceId: uuidSchema, name: nameSchema });

export async function renameWorkspaceAction(input: {
  workspaceId: string;
  name: string;
}): Promise<WorkspaceActionResult> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await renameWorkspace(access, { name: parsed.data.name });
  });
}

const currencyInputSchema = z.object({ workspaceId: uuidSchema, currency: currencySchema });

export async function setWorkspaceCurrencyAction(input: {
  workspaceId: string;
  currency: string;
}): Promise<WorkspaceActionResult> {
  const parsed = currencyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "currencyInvalid" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await setWorkspaceCurrency(access, parsed.data.currency);
  });
}

const addSchema = z.object({
  workspaceId: uuidSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: roleSchema,
});

export type AddMemberActionResult =
  | { ok: true; status: "member" | "invited" }
  | { ok: false; error: WorkspaceActionError };

/** Adds a signed-in person, or invites one who has not signed in yet. */
export async function addWorkspaceMemberAction(input: {
  workspaceId: string;
  email: string;
  role: string;
}): Promise<AddMemberActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((i) => i.path[0] === "email");
    return { ok: false, error: emailIssue ? "workspaceEmailInvalid" : "validation" };
  }
  const locale = await getLocaleFromHeaders();
  let status: "member" | "invited" = "member";
  const result = await run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    status = (await addMember(access, { email: parsed.data.email, role: parsed.data.role })).status;
  });
  return result.ok ? { ok: true, status } : result;
}

const invitationRoleSchema = z.object({
  workspaceId: uuidSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: roleSchema,
});

export async function changeWorkspaceInvitationRoleAction(input: {
  workspaceId: string;
  email: string;
  role: string;
}): Promise<WorkspaceActionResult> {
  const parsed = invitationRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await changeInvitationRole(access, { email: parsed.data.email, role: parsed.data.role });
  });
}

const invitationSchema = z.object({
  workspaceId: uuidSchema,
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export async function cancelWorkspaceInvitationAction(input: {
  workspaceId: string;
  email: string;
}): Promise<WorkspaceActionResult> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await cancelInvitation(access, { email: parsed.data.email });
  });
}

const roleChangeSchema = z.object({
  workspaceId: uuidSchema,
  userId: uuidSchema,
  role: roleSchema,
});

export async function changeWorkspaceMemberRoleAction(input: {
  workspaceId: string;
  userId: string;
  role: string;
}): Promise<WorkspaceActionResult> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await changeMemberRole(access, { userId: parsed.data.userId, role: parsed.data.role });
  });
}

const memberSchema = z.object({ workspaceId: uuidSchema, userId: uuidSchema });

export async function removeWorkspaceMemberAction(input: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceActionResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  return run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await removeMember(access, { userId: parsed.data.userId });
  });
}

const workspaceOnlySchema = z.object({ workspaceId: uuidSchema });

/** Leave, then go Home; an active cookie that pointed here falls back (§4.9). */
export async function leaveWorkspaceAction(input: {
  workspaceId: string;
}): Promise<WorkspaceActionResult> {
  const parsed = workspaceOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  const result = await run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await leaveWorkspace(access);
  });
  if (!result.ok) return result;
  await clearActiveWorkspaceCookieIf(parsed.data.workspaceId);
  return redirect({ href: "/", locale });
}

const deleteSchema = z.object({ workspaceId: uuidSchema, confirmName: z.string().max(500) });

/** Owner only, typed name (UC-31 §4.6). Redirects Home. */
export async function deleteWorkspaceAction(input: {
  workspaceId: string;
  confirmName: string;
}): Promise<WorkspaceActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  const result = await run(async () => {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await deleteWorkspace(access, { confirmName: parsed.data.confirmName });
  });
  if (!result.ok) return result;
  await clearActiveWorkspaceCookieIf(parsed.data.workspaceId);
  return redirect({ href: "/", locale });
}

/**
 * UC-31 §4.9.3: Zod → session → membership → cookie. Also clears the
 * last-opened month and revalidates the layout so every section switches.
 */
export async function setActiveWorkspaceAction(input: {
  workspaceId: string;
}): Promise<WorkspaceActionResult> {
  const parsed = workspaceOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation" };
  const locale = await getLocaleFromHeaders();
  try {
    const access = await requireWorkspaceAccess(parsed.data.workspaceId, "read", locale);
    await setActiveWorkspaceCookie(access.workspaceId);
  } catch (err) {
    const code = toError(err);
    if (code) return { ok: false, error: code };
    throw err;
  }
  await clearLastOpenedMonthCookie();
  revalidatePath("/[locale]", "layout");
  return { ok: true };
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
