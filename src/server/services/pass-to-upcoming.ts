import "server-only";
import { db } from "@/server/db/client";
import type { Month, MonthFixedLine } from "@/server/db/schema";
import {
  isPassToUpcomingAllowedYear,
  isUpcomingMonthInSameYear,
} from "@/lib/upcoming-months";
import {
  findMonthById,
  listUpcomingMonthsInYear,
} from "@/server/repositories/month";
import {
  deleteMonthLine,
  findMonthLineById,
  insertMonthLine,
} from "@/server/repositories/reserved-line";

// ============================================================================
// Pass-to-upcoming-month service (UC-18, PRD UC-23 / C21 / §7.10, ARCH §5).
//
// Cut-pastes an estimated `month_fixed_line` onto a later created month of
// the same calendar year. SQL lives only in repositories; the insert +
// hard-delete run in ONE transaction (ARCH §5, PRD §16).
//
// Domain rules:
//   - kind must be estimated (committed lines stay on this month).
//   - source month year must equal now.getFullYear() (current year only).
//   - target must already exist, same year, later month number (C6 — never
//     auto-create; C21 — no other year).
//   - Target row: remaining = original = source remaining, kind estimated,
//     origin month_only. Templates are never touched (PRD §7.8).
// ============================================================================

export class MonthLineNotFoundError extends Error {
  readonly code = "month_line_not_found" as const;
  constructor() {
    super("Reserved line not found for this tenant");
    this.name = "MonthLineNotFoundError";
  }
}

export class CommittedLineCannotPassToUpcomingError extends Error {
  readonly code = "committed_line_cannot_pass_to_upcoming" as const;
  constructor() {
    super("Only estimated lines can move to an upcoming month");
    this.name = "CommittedLineCannotPassToUpcomingError";
  }
}

export class NotCurrentYearError extends Error {
  readonly code = "not_current_year" as const;
  constructor() {
    super("Pass to upcoming month is only available in the current calendar year");
    this.name = "NotCurrentYearError";
  }
}

export class TargetMonthNotFoundError extends Error {
  readonly code = "target_month_not_found" as const;
  constructor() {
    super("Target month not found for this tenant");
    this.name = "TargetMonthNotFoundError";
  }
}

export class TargetNotUpcomingError extends Error {
  readonly code = "target_not_upcoming" as const;
  constructor() {
    super("Target must be a later month of the same year");
    this.name = "TargetNotUpcomingError";
  }
}

export interface UpcomingMonthOption {
  id: string;
  year: number;
  month: number;
}

export interface PassToUpcomingMonthInput {
  lineId: string;
  targetMonthId: string;
}

export interface PassToUpcomingMonthResult {
  created: MonthFixedLine;
  sourceYear: number;
  sourceMonth: number;
  targetYear: number;
  targetMonth: number;
}

export async function listUpcomingMonthsForPass(
  userId: string,
  year: number,
  monthValue: number,
  now: Date = new Date(),
): Promise<UpcomingMonthOption[]> {
  if (!isPassToUpcomingAllowedYear(year, now)) {
    return [];
  }
  const rows = await listUpcomingMonthsInYear(userId, year, monthValue);
  return rows.map((row) => ({
    id: row.id,
    year: row.year,
    month: row.month,
  }));
}

export async function passToUpcomingMonth(
  userId: string,
  input: PassToUpcomingMonthInput,
  now: Date = new Date(),
): Promise<PassToUpcomingMonthResult> {
  const line = await findMonthLineById(userId, input.lineId);
  if (!line) {
    throw new MonthLineNotFoundError();
  }
  if (line.kind !== "estimated") {
    throw new CommittedLineCannotPassToUpcomingError();
  }

  const sourceMonth = await findMonthById(userId, line.monthId);
  if (!sourceMonth) {
    throw new MonthLineNotFoundError();
  }
  if (!isPassToUpcomingAllowedYear(sourceMonth.year, now)) {
    throw new NotCurrentYearError();
  }

  const targetMonth = await findMonthById(userId, input.targetMonthId);
  if (!targetMonth) {
    throw new TargetMonthNotFoundError();
  }
  assertTargetIsUpcoming(sourceMonth, targetMonth);

  const created = await db.transaction(async (tx) => {
    const inserted = await insertMonthLine(
      {
        monthId: targetMonth.id,
        categoryId: line.categoryId,
        name: line.name,
        observations: line.observations,
        remainingAmount: line.remainingAmount,
        originalAmount: line.remainingAmount,
        kind: "estimated",
        origin: "month_only",
      },
      tx,
    );
    const deleted = await deleteMonthLine(userId, line.id, tx);
    if (!deleted) {
      throw new MonthLineNotFoundError();
    }
    return inserted;
  });

  return {
    created,
    sourceYear: sourceMonth.year,
    sourceMonth: sourceMonth.month,
    targetYear: targetMonth.year,
    targetMonth: targetMonth.month,
  };
}

function assertTargetIsUpcoming(source: Month, target: Month): void {
  if (
    !isUpcomingMonthInSameYear(
      { year: source.year, month: source.month },
      { year: target.year, month: target.month },
    )
  ) {
    throw new TargetNotUpcomingError();
  }
}
