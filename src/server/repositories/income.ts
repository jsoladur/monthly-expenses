import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  month,
  monthIncome,
  type MonthIncome,
  type NewMonthIncome,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Month income repository (UC-07, PRD §6.5 / §7.8, ARCH §4 / §5).
//
// `month_income` has no direct `user_id` column — tenancy flows through the
// `month` parent (FK `month_income.month_id → month.id`). Every function
// here either:
//
//   (a) takes the resolved `monthId` (which the caller has already verified
//       belongs to the tenant), OR
//   (b) joins on `month` to filter by `month.user_id = userId` directly.
//
// We never run a `WHERE month_id = ?` without the join — that would be the
// canonical "missing user_id filter is a P0 bug" mistake (PRD §5.1).
//
// Money columns live as `numeric(14,2)` strings end-to-end (ADR-5, ARCH §8) —
// this repository NEVER converts them.
//
// `Tx` is the Drizzle transaction handle; service functions accept it so
// callers can compose insert + side effects in one transaction.
// ============================================================================

export async function insertIncome(
  row: NewMonthIncome,
  tx: Tx | typeof db = db,
): Promise<MonthIncome> {
  const [created] = await tx.insert(monthIncome).values(row).returning();
  if (!created) {
    throw new Error("insertIncome returned no rows");
  }
  return created;
}

export async function findIncomeById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<MonthIncome | null> {
  // JOIN on `month` so the row is only visible if the parent month belongs
  // to the tenant — every edit/delete path needs this guard.
  const rows = await tx
    .select({
      id: monthIncome.id,
      monthId: monthIncome.monthId,
      categoryId: monthIncome.categoryId,
      name: monthIncome.name,
      amount: monthIncome.amount,
      createdAt: monthIncome.createdAt,
      updatedAt: monthIncome.updatedAt,
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthIncome.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateIncome(
  userId: string,
  id: string,
  patch: {
    categoryId: string;
    name: string;
    amount: string;
  },
  tx: Tx | typeof db = db,
): Promise<MonthIncome | null> {
  // PG supports `UPDATE ... FROM other_table WHERE ...`. Drizzle exposes
  // `.from()` on update builders, so we filter by both the income row id
  // AND the parent month's user_id in one statement.
  const updated = await tx
    .update(monthIncome)
    .set({
      categoryId: patch.categoryId,
      name: patch.name,
      amount: patch.amount,
      updatedAt: sql`now()`,
    })
    .from(month)
    .where(
      and(
        eq(monthIncome.monthId, month.id),
        eq(month.userId, userId),
        eq(monthIncome.id, id),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export async function deleteIncome(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  // Drizzle's PG delete builder does not expose `.using()`. Use a raw
  // subquery join so the WHERE clause enforces tenancy (PRD §5.1) in a
  // single statement — PRD C15 / §13 hard delete on month-scoped money.
  const deleted = await tx.execute<{ id: string }>(sql`
    DELETE FROM ${monthIncome}
    WHERE ${monthIncome.id} = ${id}
      AND ${monthIncome.monthId} IN (
        SELECT id FROM ${month} WHERE user_id = ${userId}
      )
    RETURNING id
  `);
  return deleted.length > 0;
}

export async function listIncomesForMonth(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthIncome[]> {
  return tx
    .select({
      id: monthIncome.id,
      monthId: monthIncome.monthId,
      categoryId: monthIncome.categoryId,
      name: monthIncome.name,
      amount: monthIncome.amount,
      createdAt: monthIncome.createdAt,
      updatedAt: monthIncome.updatedAt,
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthIncome.monthId, monthId)))
    .orderBy(monthIncome.createdAt);
}
