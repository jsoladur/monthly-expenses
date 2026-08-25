import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  annual,
  type Annual,
  type NewAnnual,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Annual repository (UC-14, ARCH §4).
//
// Yearly recurring expense reminders. Every function takes `userId` as its
// FIRST argument and applies it in every WHERE clause (PRD §5.1, ARCH §5 rule 1).
//
// `annual.active` is the soft-delete flag — inactive rows are EXCLUDED from
// `getAnnualReminders` (the reminder query), and INCLUDED in
// `listAnnuals` (so the user can scan history and reactivate).
//
// `Tx` is the Drizzle transaction handle; repository functions accept it so
// the service layer can compose them inside a transaction when needed
// (ARCH §5 rule: services own transactions).
// ============================================================================

export async function listAnnuals(
  userId: string,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Annual[]> {
  const where = includeInactive
    ? eq(annual.userId, userId)
    : and(eq(annual.userId, userId), eq(annual.active, true));
  return tx
    .select()
    .from(annual)
    .where(where)
    .orderBy(asc(annual.chargeMonth), asc(annual.name));
}

export async function findAnnualById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Annual | null> {
  const rows = await tx
    .select()
    .from(annual)
    .where(and(eq(annual.userId, userId), eq(annual.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAnnualReminders(
  userId: string,
  chargeMonth: number,
  tx: Tx | typeof db = db,
): Promise<Annual[]> {
  return tx
    .select()
    .from(annual)
    .where(
      and(
        eq(annual.userId, userId),
        eq(annual.chargeMonth, chargeMonth),
        eq(annual.active, true),
      ),
    )
    .orderBy(asc(annual.name));
}

export async function insertAnnual(
  row: NewAnnual,
  tx: Tx | typeof db = db,
): Promise<Annual> {
  const [created] = await tx.insert(annual).values(row).returning();
  if (!created) {
    throw new Error("insertAnnual returned no rows");
  }
  return created;
}

export async function updateAnnual(
  userId: string,
  id: string,
  patch: {
    categoryId: string;
    name: string;
    observations: string | null;
    amount: string | null;
    chargeMonth: number;
    isDirectDebit: boolean;
  },
  tx: Tx | typeof db = db,
): Promise<Annual | null> {
  const [updated] = await tx
    .update(annual)
    .set({
      categoryId: patch.categoryId,
      name: patch.name,
      observations: patch.observations,
      amount: patch.amount,
      chargeMonth: patch.chargeMonth,
      isDirectDebit: patch.isDirectDebit,
      updatedAt: sql`now()`,
    })
    .where(and(eq(annual.userId, userId), eq(annual.id, id)))
    .returning();
  return updated ?? null;
}

export async function deactivateAnnual(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Annual | null> {
  const [updated] = await tx
    .update(annual)
    .set({ active: false, deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(annual.userId, userId),
        eq(annual.id, id),
        eq(annual.active, true),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function reactivateAnnual(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Annual | null> {
  const [updated] = await tx
    .update(annual)
    .set({ active: true, deletedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(annual.userId, userId),
        eq(annual.id, id),
        eq(annual.active, false),
      ),
    )
    .returning();
  return updated ?? null;
}
