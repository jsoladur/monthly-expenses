import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  month,
  monthActualExpense,
  monthFixedLine,
  monthIncome,
  type Month,
  type MonthActualExpense,
  type MonthFixedLine,
  type MonthIncome,
  type NewMonth,
  type NewMonthFixedLine,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Month repository (UC-06, PRD §6.3 / §7.8, ARCH §4 / §5).
//
// The single entry point for SQL on the month-scoped money rows. Every
// function takes `userId` as its FIRST argument and applies it in every WHERE
// clause (PRD §5.1, ARCH §5 rule 1). Money columns live as `numeric(14,2)`
// strings end-to-end (ADR-5, ARCH §8) — this repository NEVER converts them.
//
// `Tx` is the Drizzle transaction handle so the service layer can compose
// insert + clone inside one transaction (ARCH §5 rule: services own
// transactions). The same `Tx` type is used by every other repo so callers
// don't have to think about which repo is in-transaction vs not.
// ============================================================================

export async function findMonthByPeriod(
  userId: string,
  year: number,
  monthValue: number,
  tx: Tx | typeof db = db,
): Promise<Month | null> {
  const rows = await tx
    .select()
    .from(month)
    .where(
      and(
        eq(month.userId, userId),
        eq(month.year, year),
        eq(month.month, monthValue),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMonthById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Month | null> {
  const rows = await tx
    .select()
    .from(month)
    .where(and(eq(month.userId, userId), eq(month.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertMonth(
  row: NewMonth,
  tx: Tx | typeof db = db,
): Promise<Month> {
  const [created] = await tx.insert(month).values(row).returning();
  if (!created) {
    throw new Error("insertMonth returned no rows");
  }
  return created;
}

export async function listMonths(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Month[]> {
  return tx
    .select()
    .from(month)
    .where(eq(month.userId, userId))
    .orderBy(desc(month.year), desc(month.month));
}

export async function listMonthYears(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<number[]> {
  const rows = await tx
    .select({ year: month.year })
    .from(month)
    .where(eq(month.userId, userId))
    .groupBy(month.year)
    .orderBy(desc(month.year));
  return rows.map((r) => r.year);
}

export async function listMonthsByYear(
  userId: string,
  year: number,
  tx: Tx | typeof db = db,
): Promise<Month[]> {
  return tx
    .select()
    .from(month)
    .where(and(eq(month.userId, userId), eq(month.year, year)))
    .orderBy(desc(month.month));
}

export async function insertClonedLines(
  rows: NewMonthFixedLine[],
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine[]> {
  if (rows.length === 0) return [];
  const inserted = await tx.insert(monthFixedLine).values(rows).returning();
  return inserted;
}

export async function listMonthFixedLines(
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine[]> {
  return tx
    .select()
    .from(monthFixedLine)
    .where(eq(monthFixedLine.monthId, monthId))
    .orderBy(monthFixedLine.kind, monthFixedLine.createdAt);
}

export async function listMonthIncomes(
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthIncome[]> {
  return tx
    .select()
    .from(monthIncome)
    .where(eq(monthIncome.monthId, monthId))
    .orderBy(monthIncome.createdAt);
}

export async function listMonthActuals(
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense[]> {
  return tx
    .select()
    .from(monthActualExpense)
    .where(eq(monthActualExpense.monthId, monthId))
    .orderBy(monthActualExpense.createdAt);
}
