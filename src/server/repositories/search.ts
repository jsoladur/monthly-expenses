import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { category, month, monthActualExpense } from "@/server/db/schema";
import { SQL_ACCENT_FROM, SQL_ACCENT_TO } from "@/server/search/sanitize";
import type { Tx } from "@/server/repositories/user";

export type SearchActualRow = {
  id: string;
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  amount: string;
};

export async function searchActualsByText(
  userId: string,
  sanitizedTerm: string,
  tx: Tx | typeof db = db,
): Promise<SearchActualRow[]> {
  const pattern = `%${sanitizedTerm}%`;
  const escapeChar = "\\";
  const foldedName = sql`translate(lower(${monthActualExpense.name}), ${SQL_ACCENT_FROM}, ${SQL_ACCENT_TO})`;
  const foldedObs = sql`translate(lower(COALESCE(${monthActualExpense.observations}, '')), ${SQL_ACCENT_FROM}, ${SQL_ACCENT_TO})`;

  return tx
    .select({
      id: monthActualExpense.id,
      monthId: monthActualExpense.monthId,
      year: month.year,
      month: month.month,
      categoryId: monthActualExpense.categoryId,
      categoryName: category.name,
      categoryActive: category.active,
      name: monthActualExpense.name,
      observations: monthActualExpense.observations,
      amount: monthActualExpense.amount,
    })
    .from(monthActualExpense)
    .innerJoin(month, eq(monthActualExpense.monthId, month.id))
    .innerJoin(category, eq(monthActualExpense.categoryId, category.id))
    .where(
      and(
        eq(month.userId, userId),
        or(
          sql`${foldedName} LIKE ${pattern} ESCAPE ${escapeChar}`,
          sql`${foldedObs} LIKE ${pattern} ESCAPE ${escapeChar}`,
        ),
      ),
    )
    .orderBy(desc(month.year), desc(month.month), desc(monthActualExpense.createdAt))
    .limit(101);
}
