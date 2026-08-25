import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  month,
  monthActualExpense,
  type MonthActualExpense,
  type NewMonthActualExpense,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Month actual-expense repository (UC-08, PRD §6.7 / §7.2 / §7.3 / C15,
// ARCH §4 / §5).
//
// `month_actual_expense` has no direct `user_id` column — tenancy flows
// through the `month` parent (FK `month_actual_expense.month_id → month.id`).
// Every function here either:
//   (a) takes the resolved `monthId` (which the caller has already verified
//       belongs to the tenant), OR
//   (b) joins on `month` to filter by `month.user_id = userId` directly.
//
// We never run a `WHERE month_id = ?` without the join — that would be the
// canonical "missing user_id filter is a P0 bug" mistake (PRD §5.1).
//
// Money columns live as `numeric(14,2)` strings end-to-end (ADR-5, ARCH §8)
// — this repository NEVER converts them.
//
// `Tx` is the Drizzle transaction handle; service functions accept it so
// callers can compose insert + side effects in one transaction.
//
// `observations` is nullable (PRD §6.7). `edited_after_conversion` is the
// undo gate for UC-10 (PRD §7.5): the service layer ALWAYS sets it to true
// on edit so undo is suppressed the moment a user touches a converted
// ticket (PRD §7.5). We expose a dedicated flag on `updateActual` instead
// of accepting a blanket patch, so the repo signature enforces the rule.
// ============================================================================

export async function insertActual(
  row: NewMonthActualExpense,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense> {
  const [created] = await tx.insert(monthActualExpense).values(row).returning();
  if (!created) {
    throw new Error("insertActual returned no rows");
  }
  return created;
}

export async function findActualById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense | null> {
  // JOIN on `month` so the row is only visible if the parent month belongs
  // to the tenant — every edit/delete path needs this guard.
  const rows = await tx
    .select({
      id: monthActualExpense.id,
      monthId: monthActualExpense.monthId,
      categoryId: monthActualExpense.categoryId,
      name: monthActualExpense.name,
      observations: monthActualExpense.observations,
      amount: monthActualExpense.amount,
      convertedFromLineId: monthActualExpense.convertedFromLineId,
      convertedLineOriginalAmount: monthActualExpense.convertedLineOriginalAmount,
      convertedLineOrigin: monthActualExpense.convertedLineOrigin,
      convertedLineKind: monthActualExpense.convertedLineKind,
      editedAfterConversion: monthActualExpense.editedAfterConversion,
      createdAt: monthActualExpense.createdAt,
      updatedAt: monthActualExpense.updatedAt,
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthActualExpense.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateActualPatch {
  categoryId: string;
  name: string;
  observations: string | null;
  amount: string;
}

export async function updateActual(
  userId: string,
  id: string,
  patch: UpdateActualPatch,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense | null> {
  // PG supports `UPDATE ... FROM other_table WHERE ...`. Drizzle exposes
  // `.from()` on update builders, so we filter by both the actual row id
  // AND the parent month's user_id in one statement.
  //
  // `edited_after_conversion = true` is set unconditionally on every edit
  // (PRD §7.5) — that's the undo gate UC-10 will key off.
  const updated = await tx
    .update(monthActualExpense)
    .set({
      categoryId: patch.categoryId,
      name: patch.name,
      observations: patch.observations,
      amount: patch.amount,
      editedAfterConversion: true,
      updatedAt: sql`now()`,
    })
    .from(month)
    .where(
      and(
        eq(monthActualExpense.monthId, month.id),
        eq(month.userId, userId),
        eq(monthActualExpense.id, id),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export async function deleteActual(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  // Drizzle's PG delete builder does not expose `.using()`. Use a raw
  // subquery join so the WHERE clause enforces tenancy (PRD §5.1) in a
  // single statement — PRD C15 / §13 hard delete on month-scoped money.
  const deleted = await tx.execute<{ id: string }>(sql`
    DELETE FROM ${monthActualExpense}
    WHERE ${monthActualExpense.id} = ${id}
      AND ${monthActualExpense.monthId} IN (
        SELECT id FROM ${month} WHERE user_id = ${userId}
      )
    RETURNING id
  `);
  return deleted.length > 0;
}

export async function listActualsForMonthForUser(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense[]> {
  return tx
    .select({
      id: monthActualExpense.id,
      monthId: monthActualExpense.monthId,
      categoryId: monthActualExpense.categoryId,
      name: monthActualExpense.name,
      observations: monthActualExpense.observations,
      amount: monthActualExpense.amount,
      convertedFromLineId: monthActualExpense.convertedFromLineId,
      convertedLineOriginalAmount: monthActualExpense.convertedLineOriginalAmount,
      convertedLineOrigin: monthActualExpense.convertedLineOrigin,
      convertedLineKind: monthActualExpense.convertedLineKind,
      editedAfterConversion: monthActualExpense.editedAfterConversion,
      createdAt: monthActualExpense.createdAt,
      updatedAt: monthActualExpense.updatedAt,
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthActualExpense.monthId, monthId)))
    .orderBy(monthActualExpense.createdAt);
}
