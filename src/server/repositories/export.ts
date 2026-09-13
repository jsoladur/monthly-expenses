import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  category,
  month,
  monthActualExpense,
  monthFixedLine,
  monthIncome,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Excel export repository (UC-19, PRD UC-24 / C22, ARCH §5 rule 1).
//
// Bulk reads of month-scoped money rows. Every query takes `userId` first
// and joins `month` so `month.user_id` is never optional (PRD §5.1).
// Money columns stay `numeric(14,2)` strings — this file never converts.
// ============================================================================

export type ExportIncomeRecord = {
  monthId: string;
  categoryName: string;
  name: string;
  amount: string;
  createdAt: Date;
};

export type ExportActualRecord = {
  monthId: string;
  categoryName: string;
  name: string;
  observations: string | null;
  amount: string;
  createdAt: Date;
};

export type ExportLineRecord = {
  monthId: string;
  categoryName: string;
  name: string;
  observations: string | null;
  remainingAmount: string;
  originalAmount: string;
  kind: "committed" | "estimated";
  origin: "cloned" | "month_only";
};

export async function listExportIncomes(
  userId: string,
  monthIds: string[],
  tx: Tx | typeof db = db,
): Promise<ExportIncomeRecord[]> {
  if (monthIds.length === 0) return [];
  return tx
    .select({
      monthId: monthIncome.monthId,
      categoryName: category.name,
      name: monthIncome.name,
      amount: monthIncome.amount,
      createdAt: monthIncome.createdAt,
    })
    .from(monthIncome)
    .innerJoin(month, eq(monthIncome.monthId, month.id))
    .innerJoin(category, eq(monthIncome.categoryId, category.id))
    .where(and(eq(month.userId, userId), inArray(monthIncome.monthId, monthIds)))
    .orderBy(asc(monthIncome.createdAt));
}

export async function listExportActuals(
  userId: string,
  monthIds: string[],
  tx: Tx | typeof db = db,
): Promise<ExportActualRecord[]> {
  if (monthIds.length === 0) return [];
  return tx
    .select({
      monthId: monthActualExpense.monthId,
      categoryName: category.name,
      name: monthActualExpense.name,
      observations: monthActualExpense.observations,
      amount: monthActualExpense.amount,
      createdAt: monthActualExpense.createdAt,
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(
      and(eq(month.userId, userId), inArray(monthActualExpense.monthId, monthIds)),
    )
    .orderBy(asc(monthActualExpense.createdAt));
}

export async function listExportLines(
  userId: string,
  monthIds: string[],
  tx: Tx | typeof db = db,
): Promise<ExportLineRecord[]> {
  if (monthIds.length === 0) return [];
  return tx
    .select({
      monthId: monthFixedLine.monthId,
      categoryName: category.name,
      name: monthFixedLine.name,
      observations: monthFixedLine.observations,
      remainingAmount: monthFixedLine.remainingAmount,
      originalAmount: monthFixedLine.originalAmount,
      kind: monthFixedLine.kind,
      origin: monthFixedLine.origin,
    })
    .from(monthFixedLine)
    .innerJoin(month, eq(monthFixedLine.monthId, month.id))
    .innerJoin(category, eq(monthFixedLine.categoryId, category.id))
    .where(and(eq(month.userId, userId), inArray(monthFixedLine.monthId, monthIds)))
    .orderBy(asc(monthFixedLine.createdAt));
}
