import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  template,
  type LineKind,
  type NewTemplate,
  type Template,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Template repository (UC-05, PRD §6.3 / §7.4, ARCH §4).
//
// The clone source for `month_fixed_line` and the overspend baseline for the
// summary (PRD §7.4). Every function takes `userId` as its FIRST argument
// and applies it in every WHERE clause (PRD §5.1, ARCH §5 rule 1).
//
// `template.active` is the soft-delete flag — inactive rows are EXCLUDED from
// `listActiveTemplates*` (the clone source), and INCLUDED in
// `listTemplatesForManagement` (so the user can scan history and reactivate).
//
// `Tx` is the Drizzle transaction handle; repository functions accept it so
// the service layer can compose them inside a transaction when needed
// (ARCH §5 rule: services own transactions).
// ============================================================================

export async function listTemplates(
  userId: string,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  const where = includeInactive
    ? eq(template.userId, userId)
    : and(eq(template.userId, userId), eq(template.active, true));
  return tx
    .select()
    .from(template)
    .where(where)
    .orderBy(asc(template.kind), asc(template.createdAt));
}

export async function listTemplatesByKind(
  userId: string,
  kind: LineKind,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  const where = includeInactive
    ? and(eq(template.userId, userId), eq(template.kind, kind))
    : and(
        eq(template.userId, userId),
        eq(template.kind, kind),
        eq(template.active, true),
      );
  return tx
    .select()
    .from(template)
    .where(where)
    .orderBy(asc(template.createdAt));
}

export async function listActiveTemplates(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listTemplates(userId, { includeInactive: false }, tx);
}

export async function listActiveTemplatesByKind(
  userId: string,
  kind: LineKind,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listTemplatesByKind(userId, kind, { includeInactive: false }, tx);
}

export async function findTemplateById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const rows = await tx
    .select()
    .from(template)
    .where(and(eq(template.userId, userId), eq(template.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertTemplate(
  row: NewTemplate,
  tx: Tx | typeof db = db,
): Promise<Template> {
  const [created] = await tx.insert(template).values(row).returning();
  if (!created) {
    throw new Error("insertTemplate returned no rows");
  }
  return created;
}

export async function updateTemplate(
  userId: string,
  id: string,
  patch: {
    categoryId: string;
    name: string;
    observations: string | null;
    amount: string;
    kind: LineKind;
  },
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const [updated] = await tx
    .update(template)
    .set({
      categoryId: patch.categoryId,
      name: patch.name,
      observations: patch.observations,
      amount: patch.amount,
      kind: patch.kind,
      updatedAt: sql`now()`,
    })
    .where(and(eq(template.userId, userId), eq(template.id, id)))
    .returning();
  return updated ?? null;
}

export async function deactivateTemplate(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  // Guard clause on `active = true` so a double-deactivate is a no-op rather
  // than overwriting the original `deletedAt`. The service translates the
  // `null` return into `TemplateAlreadyInactiveError`.
  const [updated] = await tx
    .update(template)
    .set({ active: false, deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(template.userId, userId),
        eq(template.id, id),
        eq(template.active, true),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function reactivateTemplate(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const [updated] = await tx
    .update(template)
    .set({ active: true, deletedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(template.userId, userId),
        eq(template.id, id),
        eq(template.active, false),
      ),
    )
    .returning();
  return updated ?? null;
}
