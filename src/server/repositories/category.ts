import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  category,
  type Category,
  type CategoryKind,
  type NewCategory,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Category repository (UC-03, PRD §6.2, ARCH §4).
//
// Soft-delete-only catalog. Every function takes `userId` as its FIRST
// argument and applies it in every `WHERE` (PRD §5.1, ARCH §5 rule 1).
//
// The schema enforces the partial unique index
// `category_active_name_uk ON (user_id, kind, name) WHERE active` so the
// repository never has to check uniqueness itself — the service layer
// catches Postgres 23505 and translates it to `DuplicateCategoryNameError`.
//
// `Tx` is the Drizzle transaction handle; repository functions accept it so
// the service layer can compose them inside a transaction when needed
// (ARCH §5 rule: services own transactions).
// ============================================================================

export async function listCategories(
  userId: string,
  kind: CategoryKind,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Category[]> {
  const where = includeInactive
    ? and(eq(category.userId, userId), eq(category.kind, kind))
    : and(
        eq(category.userId, userId),
        eq(category.kind, kind),
        eq(category.active, true),
      );
  return tx
    .select()
    .from(category)
    .where(where)
    .orderBy(asc(category.name), asc(category.createdAt));
}

export async function listActiveCategories(
  userId: string,
  kind: CategoryKind,
  tx: Tx | typeof db = db,
): Promise<Category[]> {
  return listCategories(userId, kind, { includeInactive: false }, tx);
}

export async function findCategoryById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Category | null> {
  const rows = await tx
    .select()
    .from(category)
    .where(and(eq(category.userId, userId), eq(category.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertCategory(
  row: NewCategory,
  tx: Tx | typeof db = db,
): Promise<Category> {
  const [created] = await tx.insert(category).values(row).returning();
  if (!created) {
    throw new Error("insertCategory returned no rows");
  }
  return created;
}

export async function updateCategoryName(
  userId: string,
  id: string,
  name: string,
  tx: Tx | typeof db = db,
): Promise<Category | null> {
  const [updated] = await tx
    .update(category)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(category.userId, userId), eq(category.id, id)))
    .returning();
  return updated ?? null;
}

export async function deactivateCategory(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Category | null> {
  // Guard clause on `active = true` so a double-deactivate is a no-op rather
  // than overwriting the original `deletedAt`. The service translates the
  // `null` return into `CategoryAlreadyInactiveError`.
  const [updated] = await tx
    .update(category)
    .set({ active: false, deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(category.userId, userId),
        eq(category.id, id),
        eq(category.active, true),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function reactivateCategory(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Category | null> {
  const [updated] = await tx
    .update(category)
    .set({ active: true, deletedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(category.userId, userId),
        eq(category.id, id),
        eq(category.active, false),
      ),
    )
    .returning();
  return updated ?? null;
}
