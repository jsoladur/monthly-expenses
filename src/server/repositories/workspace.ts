import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  annual,
  appUser,
  category,
  month,
  template,
  workspace,
  workspaceInvitation,
  workspaceMember,
  type Workspace,
  type WorkspaceKind,
  type WorkspaceMember,
  type WorkspaceRoleValue,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Workspace repository (UC-31, PRD C30–C31, ARCH ADR-12).
//
// The workspace + membership tables. Functions that act on ONE workspace take
// `workspaceId` first (ARCH §5 rule 1). The two identity lookups
// (`findPrivateWorkspaceByUser`, `listWorkspacesForUser`) are keyed by the
// session user, because they are how the active workspace is found.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id can never match a row; skip the query (no 22P02 leak). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export async function findPrivateWorkspaceByUser(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Workspace | null> {
  const rows = await tx
    .select()
    .from(workspace)
    .where(eq(workspace.personalUserId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Private workspace + Owner membership. Idempotent: a concurrent or repeated
 * call inserts nothing (partial unique index on `personal_user_id`).
 */
export async function insertPrivateWorkspace(
  userId: string,
  currency: string,
  tx: Tx | typeof db = db,
): Promise<Workspace> {
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO ${workspace} (kind, personal_user_id, currency)
    VALUES ('private', ${userId}, ${currency})
    ON CONFLICT (personal_user_id) WHERE personal_user_id IS NOT NULL DO NOTHING
    RETURNING id
  `);
  const found = await findPrivateWorkspaceByUser(userId, tx);
  if (!found) throw new Error("insertPrivateWorkspace: workspace missing");
  if (inserted.length > 0) {
    await tx
      .insert(workspaceMember)
      .values({ workspaceId: found.id, userId, role: "owner" })
      .onConflictDoNothing();
  }
  return found;
}

export interface WorkspaceForUser {
  id: string;
  kind: WorkspaceKind;
  name: string | null;
  currency: string;
  role: WorkspaceRoleValue;
}

/** Private first, then shared by name. */
export async function listWorkspacesForUser(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<WorkspaceForUser[]> {
  return tx
    .select({
      id: workspace.id,
      kind: workspace.kind,
      name: workspace.name,
      currency: workspace.currency,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, userId))
    .orderBy(
      sql`CASE WHEN ${workspace.kind} = 'private' THEN 0 ELSE 1 END`,
      sql`lower(${workspace.name})`,
      asc(workspace.createdAt),
    );
}

export interface Membership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleValue;
  kind: WorkspaceKind;
}

export async function findMembership(
  workspaceId: string,
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Membership | null> {
  if (!isUuid(workspaceId)) return null;
  const rows = await tx
    .select({
      workspaceId: workspaceMember.workspaceId,
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      kind: workspace.kind,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findWorkspaceById(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<Workspace | null> {
  if (!isUuid(workspaceId)) return null;
  const rows = await tx.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
  return rows[0] ?? null;
}

export async function insertWorkspace(
  row: { name: string; currency: string; ownerUserId: string },
  tx: Tx | typeof db = db,
): Promise<Workspace> {
  const [created] = await tx
    .insert(workspace)
    .values({ kind: "shared", name: row.name, currency: row.currency })
    .returning();
  if (!created) throw new Error("insertWorkspace returned no rows");
  await tx
    .insert(workspaceMember)
    .values({ workspaceId: created.id, userId: row.ownerUserId, role: "owner" });
  return created;
}

export async function updateWorkspace(
  workspaceId: string,
  patch: { name?: string; currency?: string },
  tx: Tx | typeof db = db,
): Promise<Workspace | null> {
  const [updated] = await tx
    .update(workspace)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(workspace.id, workspaceId))
    .returning();
  return updated ?? null;
}

/**
 * Hard delete of a shared workspace, children first (UC-31 §4.6.3), one
 * statement per table inside the caller's transaction. The FKs cascade too;
 * the explicit order keeps the intent visible and independent of them.
 */
export async function deleteWorkspaceCascade(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  const months = sql`(SELECT id FROM ${month} WHERE workspace_id = ${workspaceId})`;
  await tx.execute(sql`DELETE FROM month_actual_expense WHERE month_id IN ${months}`);
  await tx.execute(sql`DELETE FROM month_fixed_line WHERE month_id IN ${months}`);
  await tx.execute(sql`DELETE FROM month_income WHERE month_id IN ${months}`);
  await tx.delete(month).where(eq(month.workspaceId, workspaceId));
  await tx.delete(template).where(eq(template.workspaceId, workspaceId));
  await tx.delete(annual).where(eq(annual.workspaceId, workspaceId));
  await tx.delete(category).where(eq(category.workspaceId, workspaceId));
  await tx.delete(workspaceInvitation).where(eq(workspaceInvitation.workspaceId, workspaceId));
  await tx.delete(workspaceMember).where(eq(workspaceMember.workspaceId, workspaceId));
  const deleted = await tx
    .delete(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.kind, "shared")))
    .returning({ id: workspace.id });
  return deleted.length > 0;
}

export interface WorkspaceCounts {
  months: number;
  categories: number;
  templates: number;
  annuals: number;
  members: number;
}

export async function countWorkspaceContents(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<WorkspaceCounts> {
  const [row] = await tx.execute<{
    months: number;
    categories: number;
    templates: number;
    annuals: number;
    members: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM ${month} WHERE workspace_id = ${workspaceId}) AS months,
      (SELECT count(*)::int FROM ${category} WHERE workspace_id = ${workspaceId}) AS categories,
      (SELECT count(*)::int FROM ${template} WHERE workspace_id = ${workspaceId}) AS templates,
      (SELECT count(*)::int FROM ${annual} WHERE workspace_id = ${workspaceId}) AS annuals,
      (SELECT count(*)::int FROM ${workspaceMember} WHERE workspace_id = ${workspaceId}) AS members
  `);
  return {
    months: row?.months ?? 0,
    categories: row?.categories ?? 0,
    templates: row?.templates ?? 0,
    annuals: row?.annuals ?? 0,
    members: row?.members ?? 0,
  };
}

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRoleValue;
}

export async function listMembers(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<MemberRow[]> {
  return tx
    .select({
      userId: workspaceMember.userId,
      email: appUser.email,
      displayName: appUser.displayName,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(appUser, eq(appUser.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(
      sql`CASE ${workspaceMember.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END`,
      asc(appUser.email),
    );
}

/**
 * Display names of every user who created an actual in this workspace —
 * including former members (UC-31 §4.4.3): name, or email when no name.
 */
export async function listActualAuthors(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<{ userId: string; label: string }[]> {
  return tx.execute<{ userId: string; label: string }>(sql`
    SELECT DISTINCT u.id AS "userId", COALESCE(NULLIF(trim(u.display_name), ''), u.email) AS label
    FROM month_actual_expense a
    JOIN ${month} m ON m.id = a.month_id
    JOIN ${appUser} u ON u.id = a.created_by_user_id
    WHERE m.workspace_id = ${workspaceId}
  `);
}

export async function insertMember(
  workspaceId: string,
  row: { userId: string; role: WorkspaceRoleValue },
  tx: Tx | typeof db = db,
): Promise<WorkspaceMember> {
  const [created] = await tx
    .insert(workspaceMember)
    .values({ workspaceId, userId: row.userId, role: row.role })
    .returning();
  if (!created) throw new Error("insertMember returned no rows");
  return created;
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRoleValue,
  tx: Tx | typeof db = db,
): Promise<WorkspaceMember | null> {
  const [updated] = await tx
    .update(workspaceMember)
    .set({ role, updatedAt: sql`now()` })
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteMember(
  workspaceId: string,
  userId: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  const deleted = await tx
    .delete(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .returning({ userId: workspaceMember.userId });
  return deleted.length > 0;
}

export async function countOwners(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "owner")));
  return row?.n ?? 0;
}

// ----------------------------------------------------------------------------
// Pending invitations (PO decision 2026-11-27): an allowlisted person who has
// not signed in yet. `email` is allowlist-normalized (trim + lowercase).
// ----------------------------------------------------------------------------

export interface InvitationRow {
  email: string;
  role: WorkspaceRoleValue;
  createdAt: Date;
}

export async function listInvitations(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<InvitationRow[]> {
  return tx
    .select({
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      createdAt: workspaceInvitation.createdAt,
    })
    .from(workspaceInvitation)
    .where(eq(workspaceInvitation.workspaceId, workspaceId))
    .orderBy(asc(workspaceInvitation.email));
}

export async function findInvitation(
  workspaceId: string,
  email: string,
  tx: Tx | typeof db = db,
): Promise<InvitationRow | null> {
  const rows = await tx
    .select({
      email: workspaceInvitation.email,
      role: workspaceInvitation.role,
      createdAt: workspaceInvitation.createdAt,
    })
    .from(workspaceInvitation)
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.email, email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertInvitation(
  workspaceId: string,
  row: { email: string; role: WorkspaceRoleValue; invitedByUserId: string },
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(workspaceInvitation).values({ workspaceId, ...row });
}

export async function updateInvitationRole(
  workspaceId: string,
  email: string,
  role: WorkspaceRoleValue,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  const rows = await tx
    .update(workspaceInvitation)
    .set({ role, updatedAt: sql`now()` })
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.email, email)))
    .returning({ email: workspaceInvitation.email });
  return rows.length > 0;
}

export async function deleteInvitation(
  workspaceId: string,
  email: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  const rows = await tx
    .delete(workspaceInvitation)
    .where(and(eq(workspaceInvitation.workspaceId, workspaceId), eq(workspaceInvitation.email, email)))
    .returning({ email: workspaceInvitation.email });
  return rows.length > 0;
}

/**
 * Sign-in: every pending invitation for this (normalized) email becomes a
 * membership of `userId`, then the invitations are deleted. Identity-keyed
 * like `findPrivateWorkspaceByUser`; runs inside the sign-in transaction.
 */
export async function acceptInvitationsForUser(
  userId: string,
  normalizedEmail: string,
  tx: Tx | typeof db = db,
): Promise<number> {
  const accepted = await tx.execute<{ workspace_id: string }>(sql`
    WITH taken AS (
      DELETE FROM ${workspaceInvitation}
      WHERE email = ${normalizedEmail}
      RETURNING workspace_id, role
    )
    INSERT INTO ${workspaceMember} (workspace_id, user_id, role)
    SELECT workspace_id, ${userId}, role FROM taken
    ON CONFLICT (workspace_id, user_id) DO NOTHING
    RETURNING workspace_id
  `);
  return accepted.length;
}
