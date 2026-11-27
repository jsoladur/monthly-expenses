import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appUser, workspace, workspaceTransfer } from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Workspace transfer repository (UC-32 §4.1, migration 0009).
//
// `workspaceId` first, like every tenant repository (ARCH §5 rule 1). The one
// identity-keyed read, `findOffersForRecipient`, lists offers addressed to the
// session user across workspaces (Workspaces screen, header switcher).
// ============================================================================

export interface OfferRow {
  workspaceId: string;
  fromUserId: string;
  toUserId: string;
  createdAt: Date;
}

const offerColumns = {
  workspaceId: workspaceTransfer.workspaceId,
  fromUserId: workspaceTransfer.fromUserId,
  toUserId: workspaceTransfer.toUserId,
  createdAt: workspaceTransfer.createdAt,
};

export async function findOfferForWorkspace(
  workspaceId: string,
  tx: Tx | typeof db = db,
): Promise<OfferRow | null> {
  const rows = await tx
    .select(offerColumns)
    .from(workspaceTransfer)
    .where(eq(workspaceTransfer.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export interface IncomingOfferRow extends OfferRow {
  workspaceName: string | null;
  workspaceKind: "private" | "shared";
}

export async function findOffersForRecipient(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<IncomingOfferRow[]> {
  return tx
    .select({ ...offerColumns, workspaceName: workspace.name, workspaceKind: workspace.kind })
    .from(workspaceTransfer)
    .innerJoin(workspace, eq(workspace.id, workspaceTransfer.workspaceId))
    .where(eq(workspaceTransfer.toUserId, userId))
    .orderBy(asc(workspaceTransfer.createdAt));
}

/** Relies on `workspace_transfer_workspace_uk` for "already pending" (23505). */
export async function insertOffer(
  workspaceId: string,
  fromUserId: string,
  toUserId: string,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(workspaceTransfer).values({ workspaceId, fromUserId, toUserId });
}

export async function deleteOffer(workspaceId: string, tx: Tx | typeof db = db): Promise<boolean> {
  const rows = await tx
    .delete(workspaceTransfer)
    .where(eq(workspaceTransfer.workspaceId, workspaceId))
    .returning({ id: workspaceTransfer.id });
  return rows.length > 0;
}

/** Leave / remove (UC-32 rule 8): drop an offer addressed to or from `userId`. */
export async function deleteOffersForUser(
  workspaceId: string,
  userId: string,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx
    .delete(workspaceTransfer)
    .where(
      and(
        eq(workspaceTransfer.workspaceId, workspaceId),
        sql`(${workspaceTransfer.toUserId} = ${userId} OR ${workspaceTransfer.fromUserId} = ${userId})`,
      ),
    );
}

/** `SELECT … FOR UPDATE` on the workspace row (UC-32 rule 6.1). */
export async function lockWorkspace(workspaceId: string, tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT id FROM ${workspace} WHERE id = ${workspaceId} FOR UPDATE`);
}

/** Display label for a user: name, or email when no name (UC-31 §4.4.3). */
export async function findUserLabels(
  userIds: readonly string[],
  tx: Tx | typeof db = db,
): Promise<Map<string, { label: string; email: string }>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; label: string; email: string }>(sql`
    SELECT id, COALESCE(NULLIF(trim(display_name), ''), email) AS label, email
    FROM ${appUser} WHERE id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})
  `);
  return new Map(rows.map((r) => [r.id, { label: r.label, email: r.email }]));
}
