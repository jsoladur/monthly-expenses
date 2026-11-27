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
import { uniqueRecentNames } from "@/lib/actual-name-suggestions";

// ============================================================================
// Month actual-expense repository (UC-08, PRD §6.7 / §7.2 / §7.3 / C15,
// ARCH §4 / §5).
//
// `month_actual_expense` has no direct `workspace_id` column — tenancy flows
// through the `month` parent (FK `month_actual_expense.month_id → month.id`).
// Every function here either:
//   (a) takes the resolved `monthId` (which the caller has already verified
//       belongs to the tenant), OR
//   (b) joins on `month` to filter by `month.workspace_id = workspaceId` directly.
//
// We never run a `WHERE month_id = ?` without the join — that would be the
// canonical "missing workspace_id filter is a P0 bug" mistake (PRD §5.1).
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
  workspaceId: string,
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
      createdByUserId: monthActualExpense.createdByUserId,
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
    .where(and(eq(month.workspaceId, workspaceId), eq(monthActualExpense.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdateActualPatch {
  categoryId: string;
  name: string;
  observations: string | null;
  amount: string;
}

// `onlyCreatedBy` is the acting user when the Editor own-only rule applies
// (UC-31 §4.14): the row is then updated only if that user created it. `null`
// for Admin / Owner, who may edit any ticket of the workspace.
export async function updateActual(
  workspaceId: string,
  id: string,
  patch: UpdateActualPatch,
  onlyCreatedBy: string | null,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense | null> {
  // PG supports `UPDATE ... FROM other_table WHERE ...`. Drizzle exposes
  // `.from()` on update builders, so we filter by both the actual row id
  // AND the parent month's workspace_id in one statement.
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
        eq(month.workspaceId, workspaceId),
        eq(monthActualExpense.id, id),
        onlyCreatedBy === null
          ? undefined
          : eq(monthActualExpense.createdByUserId, onlyCreatedBy),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

// UC-26: re-home a ticket onto another month of the SAME tenant. Both the
// current parent month and the target month are checked against `workspaceId`
// in the one statement, so a foreign ticket or a foreign target updates
// nothing (null). A move counts as an edit for the pass-to-actual undo gate
// (PRD §7.5), so `edited_after_conversion` flips to true on converted rows;
// for plain tickets the flag is meaningless and left as-is.
export async function moveActual(
  workspaceId: string,
  id: string,
  targetMonthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense | null> {
  const moved = await tx.execute<{ id: string }>(sql`
    UPDATE ${monthActualExpense}
    SET month_id = ${targetMonthId},
        edited_after_conversion = CASE
          WHEN converted_from_line_id IS NOT NULL THEN true
          ELSE edited_after_conversion
        END,
        updated_at = now()
    WHERE ${monthActualExpense.id} = ${id}
      AND ${monthActualExpense.monthId} IN (
        SELECT id FROM ${month} WHERE workspace_id = ${workspaceId}
      )
      AND EXISTS (
        SELECT 1 FROM ${month} WHERE id = ${targetMonthId} AND workspace_id = ${workspaceId}
      )
    RETURNING id
  `);
  if (moved.length === 0) return null;
  return findActualById(workspaceId, id, tx);
}

export async function deleteActual(
  workspaceId: string,
  id: string,
  onlyCreatedBy: string | null,
  tx: Tx | typeof db = db,
): Promise<boolean> {
  // Drizzle's PG delete builder does not expose `.using()`. Use a raw
  // subquery join so the WHERE clause enforces tenancy (PRD §5.1) in a
  // single statement — PRD C15 / §13 hard delete on month-scoped money.
  const deleted = await tx.execute<{ id: string }>(sql`
    DELETE FROM ${monthActualExpense}
    WHERE ${monthActualExpense.id} = ${id}
      AND ${monthActualExpense.monthId} IN (
        SELECT id FROM ${month} WHERE workspace_id = ${workspaceId}
      )
      AND (${onlyCreatedBy}::uuid IS NULL OR ${monthActualExpense.createdByUserId} = ${onlyCreatedBy}::uuid)
    RETURNING id
  `);
  return deleted.length > 0;
}

export async function listActualsForMonthInWorkspace(
  workspaceId: string,
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
      createdByUserId: monthActualExpense.createdByUserId,
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
    .where(and(eq(month.workspaceId, workspaceId), eq(monthActualExpense.monthId, monthId)))
    .orderBy(monthActualExpense.createdAt);
}

export type ActualNameSuggestionRow = {
  name: string;
  year: number;
  month: number;
};

export async function listRecentActualNames(
  workspaceId: string,
  periods: { year: number; month: number }[],
  tx: Tx | typeof db = db,
): Promise<ActualNameSuggestionRow[]> {
  if (periods.length === 0) return [];

  const periodTuples = sql.join(
    periods.map((period) => sql`(${period.year}::int, ${period.month}::int)`),
    sql`, `,
  );

  // Bounded 3-month window (household size). Unique-on-folded-name is applied
  // here rather than DISTINCT ON: parameterizing the translate() alphabet
  // twice makes Postgres treat DISTINCT ON and ORDER BY as different
  // expressions (42P10).
  const rows = await tx.execute<{
    name: string;
    year: number;
    month: number;
  }>(sql`
    SELECT
      ${monthActualExpense.name} AS name,
      ${month.year} AS year,
      ${month.month} AS month
    FROM ${monthActualExpense}
    INNER JOIN ${month} ON ${month.id} = ${monthActualExpense.monthId}
    WHERE ${month.workspaceId} = ${workspaceId}
      AND (${month.year}, ${month.month}) IN (${periodTuples})
    ORDER BY ${monthActualExpense.createdAt} DESC
    LIMIT 1000
  `);

  return uniqueRecentNames(rows);
}
