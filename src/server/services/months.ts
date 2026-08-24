import "server-only";
import { db } from "@/server/db/client";
import {
  month,
  type Month,
  type MonthActualExpense,
  type MonthFixedLine,
  type MonthIncome,
} from "@/server/db/schema";
import {
  findMonthByPeriod,
  insertClonedLines,
  insertMonth,
  listMonthActuals,
  listMonthFixedLines,
  listMonthIncomes,
  listMonths,
  listMonthYears,
  listMonthsByYear,
} from "@/server/repositories/month";
import { listActiveTemplates } from "@/server/repositories/template";

// ============================================================================
// Months service (UC-06, PRD UC-08 / UC-14 / UC-19 / C6 / C7 / C12 / §7.8).
//
// Owns the one-time template clone at month creation (PRD C17, §6.3, §7.8).
// SQL lives only in the repository (ARCH §5 rule 1); transactions live here
// (ARCH §5 rule: services own transactions).
//
// Domain rules:
//   - `createMonth(userId, year, month)` runs in ONE transaction: insert the
//     `month` row, then bulk-insert one `month_fixed_line` row per ACTIVE
//     template (kind, observations, remaining_amount = original_amount =
//     template amount, origin = 'cloned'). The `month_user_period_uk`
//     unique index backstops the duplicate check (PRD UC-08) and surfaces
//     as `DuplicateMonthError` if a parallel request slips through.
//   - Incomes are NOT cloned (PRD §7.8).
//   - Active templates only — soft-deleted templates are excluded from the
//     clone source (PRD §6.3 / §7.8).
//   - Months are created only on explicit user action (PRD C6/C12) — there
//     is no implicit / scheduled creation.
//   - After creation the month is INDEPENDENT: edits to templates after the
//     fact never rewrite the cloned lines; months never sync with each other
//     (PRD §7.8). No rollover of unused remainings (PRD C7).
//   - `getMonthList(userId)` returns the user's months newest first
//     (PRD UC-14).
//   - `getMonthWorkspace(userId, year, month)` returns the month header +
//     reserved lines (grouped by kind), incomes, and actuals. UC-06 ships
//     the reserved-lines skeleton; UC-07/08/11 fill in the other blocks.
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class DuplicateMonthError extends Error {
  readonly code = "duplicate_month" as const;
  constructor() {
    super("That month already exists for this user");
    this.name = "DuplicateMonthError";
  }
}

export class MonthNotFoundError extends Error {
  readonly code = "month_not_found" as const;
  constructor() {
    super("Month not found for this tenant");
    this.name = "MonthNotFoundError";
  }
}

export interface MonthWorkspace {
  month: Month;
  lines: MonthFixedLine[];
  incomes: MonthIncome[];
  actuals: MonthActualExpense[];
}

export interface CreateMonthInput {
  year: number;
  month: number;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function createMonth(
  userId: string,
  input: CreateMonthInput,
): Promise<Month> {
  // Pre-flight duplicate check so a guaranteed-dup never even opens a
  // transaction. The unique index is the backstop, but checking first keeps
  // the error type stable and avoids wasting a tx round-trip.
  const existing = await findMonthByPeriod(userId, input.year, input.month);
  if (existing) {
    throw new DuplicateMonthError();
  }

  // ONE transaction: month row + cloned reserved lines. If the month insert
  // hits the unique index (concurrent caller won the race) the whole tx
  // rolls back — no orphan cloned lines (ARCH §5 rule).
  const created = await db.transaction(async (tx) => {
    const insertedMonth = await insertMonth(
      {
        userId,
        year: input.year,
        month: input.month,
      },
      tx,
    );

    const activeTemplates = await listActiveTemplates(userId, tx);

    if (activeTemplates.length > 0) {
      await insertClonedLines(
        activeTemplates.map((t) => ({
          monthId: insertedMonth.id,
          categoryId: t.categoryId,
          name: t.name,
          observations: t.observations,
          remainingAmount: t.amount,
          originalAmount: t.amount,
          kind: t.kind,
          origin: "cloned" as const,
        })),
        tx,
      );
    }

    return insertedMonth;
  });

  // After commit: if the unique index rejected the month insert, Drizzle
  // throws a Postgres 23505; map it to the domain error so callers see a
  // stable contract.
  if (!created || !created.id) {
    throw new DuplicateMonthError();
  }

  return created;
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function getMonthList(userId: string): Promise<Month[]> {
  return listMonths(userId);
}

export async function getMonthYears(userId: string): Promise<number[]> {
  return listMonthYears(userId);
}

export async function getMonthsByYear(
  userId: string,
  year: number,
): Promise<Month[]> {
  return listMonthsByYear(userId, year);
}

export async function getMonthWorkspace(
  userId: string,
  year: number,
  monthValue: number,
): Promise<MonthWorkspace> {
  const found = await findMonthByPeriod(userId, year, monthValue);
  if (!found) {
    throw new MonthNotFoundError();
  }

  // The three money-row fetches are independent reads against the same month.
  // Run them in parallel — the schema is month_id-keyed so we don't need a
  // single SQL with a JOIN.
  const [lines, incomes, actuals] = await Promise.all([
    listMonthFixedLines(found.id),
    listMonthIncomes(found.id),
    listMonthActuals(found.id),
  ]);

  return { month: found, lines, incomes, actuals };
}

// `month` is the imported Drizzle table — re-exported for tests / other
// services that want to write SQL against the schema. (Unused by the action
// layer; just here to keep the `import` honest if a future slice needs it.)
export { month };
