import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  category,
  month,
  monthActualExpense,
  monthFixedLine,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Estimate-check repository (UC-25, ARCH §5 rule 1).
//
// Read-only. Both queries join `month` and filter `month.user_id = userId`
// (PRD §5.1) — the caller still pre-checks the month with `findMonthById`
// so a foreign month surfaces as `MonthNotFoundError`, not an empty check.
// Money stays as `numeric(14,2)` strings here; the service converts.
// ============================================================================

export interface EstimatedLineRow {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  originalAmount: string;
  remainingAmount: string;
}

export async function listEstimatedLinesForMonth(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<EstimatedLineRow[]> {
  return tx
    .select({
      id: monthFixedLine.id,
      categoryId: monthFixedLine.categoryId,
      categoryName: category.name,
      name: monthFixedLine.name,
      originalAmount: monthFixedLine.originalAmount,
      remainingAmount: monthFixedLine.remainingAmount,
    })
    .from(monthFixedLine)
    .innerJoin(month, eq(monthFixedLine.monthId, month.id))
    .innerJoin(category, eq(monthFixedLine.categoryId, category.id))
    .where(
      and(
        eq(month.userId, userId),
        eq(monthFixedLine.monthId, monthId),
        eq(monthFixedLine.kind, "estimated"),
      ),
    );
}

export interface ActualTicketRow {
  id: string;
  categoryId: string;
  name: string;
  amount: string;
  convertedFromLineId: string | null;
}

export async function listActualsForMonth(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<ActualTicketRow[]> {
  return tx
    .select({
      id: monthActualExpense.id,
      categoryId: monthActualExpense.categoryId,
      name: monthActualExpense.name,
      amount: monthActualExpense.amount,
      convertedFromLineId: monthActualExpense.convertedFromLineId,
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .where(and(eq(month.userId, userId), eq(monthActualExpense.monthId, monthId)));
}
