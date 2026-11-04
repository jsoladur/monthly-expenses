import "server-only";
import { db } from "@/server/db/client";
import { findActualById, moveActual } from "@/server/repositories/actual";
import { findMonthById, listMonths } from "@/server/repositories/month";
import {
  ActualNotFoundError,
  MonthNotFoundError,
} from "@/server/services/actuals";
import {
  isMoveTargetAllowed,
  splitMoveTargets,
  type MoveMonthKey,
  type MoveTargets,
} from "@/lib/move-window";

// ============================================================================
// Move an actual expense to another month (UC-26, proposed PRD UC-28 / C26,
// ARCH §5).
//
// Rewrites `month_actual_expense.month_id` in place — same id, category,
// name, observations, amount and created_at. The window is relative to the
// ticket's month (never to today): any later created month, or up to 3
// months back. Months are never auto-created (C6). The category may be
// inactive now — a move does not create a ticket (§6.7 does not apply).
// A move counts as an edit for pass-to-actual tickets, which drops their
// undo (§7.5) so undo never re-inserts a reserved line into the wrong month.
//
// Errors reuse the actuals service classes so the action layer maps one
// i18n key for `actualNotFound` / `monthNotFound` across surfaces.
// ============================================================================

export class MoveTargetOutOfWindowError extends Error {
  readonly code = "move_target_out_of_window" as const;
  constructor() {
    super("Target month is outside the allowed move window");
    this.name = "MoveTargetOutOfWindowError";
  }
}

export interface MoveTargetMonth extends MoveMonthKey {
  id: string;
}

export interface MoveActualInput {
  actualId: string;
  targetMonthId: string;
}

export interface MoveActualResult {
  from: MoveMonthKey;
  to: MoveMonthKey;
}

export async function listMoveTargets(
  userId: string,
  monthId: string,
): Promise<MoveTargets<MoveTargetMonth>> {
  const source = await findMonthById(userId, monthId);
  if (!source) {
    throw new MonthNotFoundError();
  }
  const months = await listMonths(userId);
  return splitMoveTargets(
    { year: source.year, month: source.month },
    months.map((m) => ({ id: m.id, year: m.year, month: m.month })),
  );
}

export async function moveActualToMonth(
  userId: string,
  input: MoveActualInput,
): Promise<MoveActualResult> {
  return db.transaction(async (tx) => {
    const actual = await findActualById(userId, input.actualId, tx);
    if (!actual) {
      throw new ActualNotFoundError();
    }
    const source = await findMonthById(userId, actual.monthId, tx);
    if (!source) {
      throw new ActualNotFoundError();
    }
    const target = await findMonthById(userId, input.targetMonthId, tx);
    if (!target) {
      throw new MonthNotFoundError();
    }
    const from = { year: source.year, month: source.month };
    const to = { year: target.year, month: target.month };
    if (!isMoveTargetAllowed(from, to)) {
      throw new MoveTargetOutOfWindowError();
    }
    const moved = await moveActual(userId, actual.id, target.id, tx);
    if (!moved) {
      // Concurrent delete raced the move.
      throw new ActualNotFoundError();
    }
    return { from, to };
  });
}
