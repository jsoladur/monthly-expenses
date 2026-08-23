import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  month,
  monthFixedLine,
  type MonthFixedLine,
  type NewMonthFixedLine,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Month reserved-lines repository (UC-09, PRD §6.6 / §7.3 / §7.8, ARCH §4 / §5).
//
// `month_fixed_line` has no direct `user_id` column — tenancy flows through
// the `month` parent (FK `month_fixed_line.month_id → month.id`). Every
// function here either:
//   (a) takes the resolved `monthId` (which the caller has already verified
//       belongs to the tenant), OR
//   (b) joins on `month` to filter by `month.user_id = userId` directly.
//
// We never run a `WHERE id = ?` or `WHERE month_id = ?` without the join —
// that would be the canonical "missing user_id filter is a P0 bug" mistake
// (PRD §5.1, ARCH §5 rule 1).
//
// Money columns live as `numeric(14,2)` strings end-to-end (ADR-5, ARCH §8)
// — this repository NEVER converts them.
//
// `Tx` is the Drizzle transaction handle; service functions accept it so
// callers can compose insert + side effects in one transaction (ARCH §5 rule:
// services own transactions).
// ============================================================================

export async function insertMonthLine(
  row: NewMonthFixedLine,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine> {
  const [created] = await tx.insert(monthFixedLine).values(row).returning();
  if (!created) {
    throw new Error("insertMonthLine returned no rows");
  }
  return created;
}

export async function findMonthLineById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine | null> {
  // JOIN on `month` so the row is only visible if the parent month belongs
  // to the tenant — every update / delete path needs this guard.
  const rows = await tx
    .select({
      id: monthFixedLine.id,
      monthId: monthFixedLine.monthId,
      categoryId: monthFixedLine.categoryId,
      name: monthFixedLine.name,
      observations: monthFixedLine.observations,
      remainingAmount: monthFixedLine.remainingAmount,
      originalAmount: monthFixedLine.originalAmount,
      kind: monthFixedLine.kind,
      origin: monthFixedLine.origin,
      createdAt: monthFixedLine.createdAt,
      updatedAt: monthFixedLine.updatedAt,
    })
    .from(monthFixedLine)
    .innerJoin(month, eq(monthFixedLine.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthFixedLine.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateMonthLineRemaining(
  userId: string,
  id: string,
  remainingAmount: string,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine | null> {
  // PG supports `UPDATE ... FROM other_table WHERE ...`. Drizzle exposes
  // `.from()` on update builders, so we filter by both the line row id AND
  // the parent month's user_id in one statement.
  //
  // Only `remaining_amount` is patched — `original_amount`, `kind`, `origin`,
  // `category_id`, `name` and `observations` are immutable for the life of
  // the row (PRD §6.6). The repo signature ENFORCES the single-field patch
  // so the service cannot accidentally rewrite history.
  const updated = await tx
    .update(monthFixedLine)
    .set({
      remainingAmount,
      updatedAt: sql`now()`,
    })
    .from(month)
    .where(
      and(
        eq(monthFixedLine.monthId, month.id),
        eq(month.userId, userId),
        eq(monthFixedLine.id, id),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

export async function deleteMonthLine(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  // Drizzle's PG delete builder does not expose `.using()`. Use a raw
  // subquery join so the WHERE clause enforces tenancy (PRD §5.1) in a
  // single statement — PRD C15 / §13 hard delete on month-scoped money.
  const deleted = await tx.execute<{ id: string }>(sql`
    DELETE FROM ${monthFixedLine}
    WHERE ${monthFixedLine.id} = ${id}
      AND ${monthFixedLine.monthId} IN (
        SELECT id FROM ${month} WHERE user_id = ${userId}
      )
    RETURNING id
  `);
  return deleted.length > 0;
}
