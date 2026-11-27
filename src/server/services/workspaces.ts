import "server-only";
import { db } from "@/server/db/client";
import type { Workspace } from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";
import { findUserByNormalizedEmail } from "@/server/repositories/user";
import { getProfileSettings, updateCurrency } from "@/server/repositories/profile-settings";
import {
  countOwners,
  countWorkspaceContents,
  deleteMember,
  deleteWorkspaceCascade,
  findMembership,
  findPrivateWorkspaceByUser,
  findWorkspaceById,
  insertMember,
  insertPrivateWorkspace,
  insertWorkspace,
  listActualAuthors,
  listMembers,
  listWorkspacesForUser,
  updateMemberRole,
  updateWorkspace,
  type MemberRow,
  type WorkspaceCounts,
  type WorkspaceForUser,
} from "@/server/repositories/workspace";
import { normalizeEmail, parseAllowlist } from "@/server/auth/allowlist";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import {
  ASSIGNABLE_ROLES,
  WorkspaceNotFoundError,
  authorize,
  type AssignableRole,
  type WorkspaceAccess,
} from "@/lib/workspace-roles";
import { WORKSPACE_NAME_MAX, matchesWorkspaceName } from "@/lib/workspace-name";

// ============================================================================
// Workspaces service (UC-31, PRD UC-33 / C30–C31).
//
// Owns every workspace and membership rule: private-workspace provisioning,
// shared-workspace creation, rename/currency, members (add, re-role, remove,
// leave) and the typed-name delete. Role checks go through `authorize()` on
// the `WorkspaceAccess` the caller got from `requireWorkspaceAccess()`
// (ARCH §5 rule 1a). Errors are named classes; actions map them to keys.
// ============================================================================

export class WorkspaceEmailNotAllowedError extends Error {
  readonly code = "workspace_email_not_allowed" as const;
  constructor() {
    super("That email is not on the allowlist");
    this.name = "WorkspaceEmailNotAllowedError";
  }
}

export class WorkspaceMemberNeverSignedInError extends Error {
  readonly code = "workspace_member_never_signed_in" as const;
  constructor() {
    super("That person has not signed in yet");
    this.name = "WorkspaceMemberNeverSignedInError";
  }
}

export class WorkspaceMemberExistsError extends Error {
  readonly code = "workspace_member_exists" as const;
  constructor() {
    super("That person is already a member");
    this.name = "WorkspaceMemberExistsError";
  }
}

export class WorkspaceMemberNotFoundError extends Error {
  readonly code = "workspace_member_not_found" as const;
  constructor() {
    super("Member not found");
    this.name = "WorkspaceMemberNotFoundError";
  }
}

export class CannotRemoveOwnerError extends Error {
  readonly code = "cannot_remove_owner" as const;
  constructor() {
    super("The Owner cannot be changed or removed here");
    this.name = "CannotRemoveOwnerError";
  }
}

export class OwnerCannotLeaveError extends Error {
  readonly code = "owner_cannot_leave" as const;
  constructor() {
    super("The Owner cannot leave the workspace");
    this.name = "OwnerCannotLeaveError";
  }
}

export class PrivateWorkspaceImmutableError extends Error {
  readonly code = "private_workspace_immutable" as const;
  constructor() {
    super("A private workspace cannot be shared, renamed, left or deleted");
    this.name = "PrivateWorkspaceImmutableError";
  }
}

export class WorkspaceNameMismatchError extends Error {
  readonly code = "workspace_name_mismatch" as const;
  constructor() {
    super("The typed name does not match the workspace name");
    this.name = "WorkspaceNameMismatchError";
  }
}

export class InvalidWorkspaceNameError extends Error {
  readonly code = "invalid_workspace_name" as const;
  constructor(readonly reason: "required" | "tooLong") {
    super(`Invalid workspace name (${reason})`);
    this.name = "InvalidWorkspaceNameError";
  }
}

/** Only Reader / Editor / Admin can be given; never Owner (UC-31 §4.3.3). */
export class InvalidWorkspaceRoleError extends Error {
  readonly code = "invalid_workspace_role" as const;
  constructor() {
    super("That role cannot be assigned");
    this.name = "InvalidWorkspaceRoleError";
  }
}

export class InvalidWorkspaceCurrencyError extends Error {
  readonly code = "invalid_currency" as const;
  constructor() {
    super("Invalid currency code (expected ISO 4217 alpha-3)");
    this.name = "InvalidWorkspaceCurrencyError";
  }
}

export { WORKSPACE_NAME_MAX, matchesWorkspaceName };
const CURRENCY_RE = /^[A-Z]{3}$/;

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new InvalidWorkspaceNameError("required");
  if (name.length > WORKSPACE_NAME_MAX) throw new InvalidWorkspaceNameError("tooLong");
  return name;
}

function normalizeCurrency(raw: string): string {
  const currency = raw.trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) throw new InvalidWorkspaceCurrencyError();
  return currency;
}

function assertAssignable(role: string): asserts role is AssignableRole {
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw new InvalidWorkspaceRoleError();
  }
}

function assertShared(access: WorkspaceAccess): void {
  if (access.kind !== "shared") throw new PrivateWorkspaceImmutableError();
}

// ----------------------------------------------------------------------------
// Private workspace & the active workspace
// ----------------------------------------------------------------------------

/**
 * UC-31 §4.1: exactly one private workspace per user, currency from
 * `profile_settings` (EUR default). Idempotent; used by sign-in.
 */
export async function ensurePrivateWorkspace(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Workspace> {
  const existing = await findPrivateWorkspaceByUser(userId, tx);
  if (existing) return existing;
  const profile = await getProfileSettings(userId, tx);
  return insertPrivateWorkspace(userId, profile?.currency ?? "EUR", tx);
}

/**
 * UC-31 §4.9: the cookie's workspace when the user is still a member,
 * otherwise their private workspace (created on the fly if missing).
 */
export async function resolveActiveWorkspaceFor(
  userId: string,
  cookieValue: string | undefined | null,
): Promise<WorkspaceAccess> {
  if (cookieValue) {
    try {
      return await loadWorkspaceAccess(userId, cookieValue);
    } catch (err) {
      if (!(err instanceof WorkspaceNotFoundError)) throw err;
    }
  }
  const priv = await ensurePrivateWorkspace(userId);
  return loadWorkspaceAccess(userId, priv.id);
}

export async function listMyWorkspaces(userId: string): Promise<WorkspaceForUser[]> {
  return listWorkspacesForUser(userId);
}

// ----------------------------------------------------------------------------
// Shared workspace lifecycle
// ----------------------------------------------------------------------------

export async function createSharedWorkspace(
  userId: string,
  input: { name: string; currency: string },
): Promise<Workspace> {
  const name = normalizeName(input.name);
  const currency = normalizeCurrency(input.currency);
  return db.transaction((tx) => insertWorkspace({ name, currency, ownerUserId: userId }, tx));
}

export interface WorkspaceDetails {
  workspace: Workspace;
  role: WorkspaceAccess["role"];
  members: MemberRow[];
  counts: WorkspaceCounts;
  /** userId → "Added by" label for every ticket author, former members too. */
  authors: Record<string, string>;
}

export async function getWorkspaceDetails(access: WorkspaceAccess): Promise<WorkspaceDetails> {
  const workspaceId = authorize(access, "read");
  const [found, members, counts, authors] = await Promise.all([
    findWorkspaceById(workspaceId),
    listMembers(workspaceId),
    countWorkspaceContents(workspaceId),
    listActualAuthors(workspaceId),
  ]);
  if (!found) throw new WorkspaceNotFoundError();
  return {
    workspace: found,
    role: access.role,
    members,
    counts,
    authors: Object.fromEntries(authors.map((a) => [a.userId, a.label])),
  };
}

/** Author labels only — used by month screens of shared workspaces. */
export async function getActualAuthorLabels(
  access: WorkspaceAccess,
): Promise<Record<string, string>> {
  const workspaceId = authorize(access, "read");
  if (access.kind !== "shared") return {};
  const authors = await listActualAuthors(workspaceId);
  return Object.fromEntries(authors.map((a) => [a.userId, a.label]));
}

export async function getWorkspaceCurrency(access: WorkspaceAccess): Promise<string> {
  const workspaceId = authorize(access, "read");
  const found = await findWorkspaceById(workspaceId);
  if (!found) throw new WorkspaceNotFoundError();
  return found.currency;
}

export async function renameWorkspace(
  access: WorkspaceAccess,
  input: { name: string },
): Promise<Workspace> {
  const workspaceId = authorize(access, "manageWorkspace");
  assertShared(access);
  const updated = await updateWorkspace(workspaceId, { name: normalizeName(input.name) });
  if (!updated) throw new WorkspaceNotFoundError();
  return updated;
}

/**
 * Currency of the workspace being viewed (UC-31 §7.3, decision 7). For the
 * private workspace the value is also kept as the user's
 * `profile_settings.currency`, the default for new shared workspaces.
 */
export async function setWorkspaceCurrency(
  access: WorkspaceAccess,
  rawCurrency: string,
): Promise<Workspace> {
  const workspaceId = authorize(access, "manageWorkspace");
  const currency = normalizeCurrency(rawCurrency);
  return db.transaction(async (tx) => {
    const updated = await updateWorkspace(workspaceId, { currency }, tx);
    if (!updated) throw new WorkspaceNotFoundError();
    if (updated.kind === "private" && updated.personalUserId === access.userId) {
      await updateCurrency(access.userId, currency, tx);
    }
    return updated;
  });
}

export async function deleteWorkspace(
  access: WorkspaceAccess,
  input: { confirmName: string },
): Promise<void> {
  assertShared(access);
  const workspaceId = authorize(access, "deleteWorkspace");
  const found = await findWorkspaceById(workspaceId);
  if (!found || found.kind !== "shared") throw new WorkspaceNotFoundError();
  if (!matchesWorkspaceName(input.confirmName, found.name ?? "")) {
    throw new WorkspaceNameMismatchError();
  }
  await db.transaction(async (tx) => {
    const deleted = await deleteWorkspaceCascade(workspaceId, tx);
    if (!deleted) throw new WorkspaceNotFoundError();
  });
}

// ----------------------------------------------------------------------------
// Members
// ----------------------------------------------------------------------------

export async function addMember(
  access: WorkspaceAccess,
  input: { email: string; role: AssignableRole },
  allowlist: ReadonlySet<string> = parseAllowlist(process.env.ALLOWED_EMAILS),
): Promise<MemberRow> {
  const workspaceId = authorize(access, "manageMembers");
  assertShared(access);
  assertAssignable(input.role);
  const email = normalizeEmail(input.email);
  // Rejection order: allowlist → signed in once → not already a member.
  if (!allowlist.has(email)) throw new WorkspaceEmailNotAllowedError();
  const user = await findUserByNormalizedEmail(email);
  if (!user) throw new WorkspaceMemberNeverSignedInError();
  if (await findMembership(workspaceId, user.id)) throw new WorkspaceMemberExistsError();
  try {
    await insertMember(workspaceId, { userId: user.id, role: input.role });
  } catch (err) {
    if (isUniqueViolation(err)) throw new WorkspaceMemberExistsError();
    throw err;
  }
  return { userId: user.id, email: user.email, displayName: user.displayName, role: input.role };
}

async function requireNonOwnerMember(workspaceId: string, userId: string, tx: Tx | typeof db) {
  const target = await findMembership(workspaceId, userId, tx);
  if (!target) throw new WorkspaceMemberNotFoundError();
  if (target.role === "owner") throw new CannotRemoveOwnerError();
  return target;
}

export async function changeMemberRole(
  access: WorkspaceAccess,
  input: { userId: string; role: AssignableRole },
): Promise<void> {
  const workspaceId = authorize(access, "manageMembers");
  assertShared(access);
  assertAssignable(input.role);
  await db.transaction(async (tx) => {
    await requireNonOwnerMember(workspaceId, input.userId, tx);
    await updateMemberRole(workspaceId, input.userId, input.role, tx);
    if ((await countOwners(workspaceId, tx)) !== 1) throw new CannotRemoveOwnerError();
  });
}

export async function removeMember(
  access: WorkspaceAccess,
  input: { userId: string },
): Promise<void> {
  const workspaceId = authorize(access, "manageMembers");
  assertShared(access);
  await db.transaction(async (tx) => {
    await requireNonOwnerMember(workspaceId, input.userId, tx);
    await deleteMember(workspaceId, input.userId, tx);
  });
}

export async function leaveWorkspace(access: WorkspaceAccess): Promise<void> {
  assertShared(access);
  if (access.role === "owner") throw new OwnerCannotLeaveError();
  const workspaceId = authorize(access, "leaveWorkspace");
  const removed = await deleteMember(workspaceId, access.userId);
  if (!removed) throw new WorkspaceNotFoundError();
}

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
