import "server-only";
import { db } from "@/server/db/client";
import type { MonthActualExpense, MonthFixedLine } from "@/server/db/schema";
import { findActualById } from "@/server/repositories/actual";
import { findMonthLineById } from "@/server/repositories/reserved-line";
import { deleteMonthLine, insertMonthLine } from "@/server/repositories/reserved-line";
import { deleteActual, insertActual } from "@/server/repositories/actual";

// ============================================================================
// Pass-to-actual service (UC-10, PRD §7.5 / §7.2 / §13, ARCH §4 / §5).
//
// Owns the cut-paste between `month_fixed_line` and `month_actual_expense`
// for committed lines, plus the gated undo that restores the line. SQL lives
// only in the repository (ARCH §5 rule 1); transactions live here
// (ARCH §5 rule: services own transactions). Each operation runs in ONE
// transaction so a failure mid-way leaves no partial state (ARCH §5,
// PRD §16).
//
// Domain rules:
//   - passToActual:
//       * REJECT unless `kind = 'committed'` (PRD §7.5 / #12). Estimated
//         lines throw `EstimatedLineCannotPassError` — there is no
//         "promote estimate to actual" path.
//       * Insert `month_actual_expense` with: monthId, categoryId, name,
//         observations copied verbatim; amount = line.remaining_amount;
//         converted_from_line_id = line.id; converted_line_original_amount
//         = line.original_amount; converted_line_origin = line.origin;
//         edited_after_conversion = false (PRD §7.5).
//       * HARD-delete the source line in the SAME transaction
//         (PRD C15 / §13 / §7.5). After the move the money exists ONLY in
//         actuals (PRD §7.2) — savings algebra is unchanged because the
//         row is now in actuals instead of fixed (PRD #8).
//   - undoPassToActual:
//       * Allowed ONLY if converted_from_line_id IS NOT NULL AND
//         edited_after_conversion = false (PRD §7.5 / #9 / #10). After the
//         user edits the actual, undo is suppressed — the manual escape
//         hatch is hard-delete + re-add (PRD §7.5).
//       * Re-insert `month_fixed_line` REUSING converted_from_line_id as
//         the row id (the row was hard-deleted by pass-to-actual, so the
//         id is free for re-use) so any logical link the row used to have
//         stays stable. remaining_amount = actual.amount (current state of
//         the ticket), original_amount = converted_line_original_amount
//         (the snapshot at the original clone/insert), kind = 'committed',
//         origin = converted_line_origin; name / observations / categoryId
//         copied back (PRD §7.5).
//       * HARD-delete the actual in the SAME transaction (PRD C15 / §13).
//   - Tenancy: every read uses the `userId`-first JOIN on `month.user_id`
//     (PRD §5.1, ARCH §5 rule 1). A missing line / actual surfaces as
//     not-found; the operation never touches another tenant's rows.
//   - Both operations NEVER mutate a `template` row (PRD §7.8) — implicit
//     because the service only touches month-scoped money rows.
//   - Both operations NEVER touch an income row (PRD §6.5).
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class EstimatedLineCannotPassError extends Error {
  readonly code = "estimated_line_cannot_pass" as const;
  constructor() {
    super("Estimated lines cannot be passed to actuals (PRD §7.5)");
    this.name = "EstimatedLineCannotPassError";
  }
}

export class MonthLineNotFoundError extends Error {
  readonly code = "month_line_not_found" as const;
  constructor() {
    super("Reserved line not found for this tenant");
    this.name = "MonthLineNotFoundError";
  }
}

export class ActualNotFoundOnUndoError extends Error {
  readonly code = "actual_not_found_on_undo" as const;
  constructor() {
    super("Actual not found for this tenant (undo)");
    this.name = "ActualNotFoundOnUndoError";
  }
}

export class UndoForbiddenAfterEditError extends Error {
  readonly code = "undo_forbidden_after_edit" as const;
  constructor() {
    super("Undo is forbidden after the actual has been edited (PRD §7.5)");
    this.name = "UndoForbiddenAfterEditError";
  }
}

export class NotUndoableError extends Error {
  readonly code = "not_undoable" as const;
  constructor() {
    super("Actual was not created by pass-to-actual; nothing to undo");
    this.name = "NotUndoableError";
  }
}

export interface PassToActualInput {
  lineId: string;
}

export interface UndoPassToActualInput {
  actualId: string;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function passToActual(
  userId: string,
  input: PassToActualInput,
): Promise<MonthActualExpense> {
  // Tenancy pre-flight + kind gate (PRD §5.1, §7.5 / #12). Done OUTSIDE the
  // transaction so the read is independent and a rejected-estimated row
  // leaves no writes behind.
  const line = await findMonthLineById(userId, input.lineId);
  if (!line) {
    throw new MonthLineNotFoundError();
  }
  if (line.kind !== "committed") {
    throw new EstimatedLineCannotPassError();
  }

  // ONE transaction: insert the new actual + hard-delete the source line.
  // If either statement fails the whole tx rolls back (ARCH §5, PRD §16).
  return db.transaction(async (tx) => {
    const created = await insertActual(
      {
        monthId: line.monthId,
        categoryId: line.categoryId,
        name: line.name,
        observations: line.observations,
        amount: line.remainingAmount,
        convertedFromLineId: line.id,
        convertedLineOriginalAmount: line.originalAmount,
        convertedLineOrigin: line.origin,
        editedAfterConversion: false,
      },
      tx,
    );
    await deleteMonthLine(userId, line.id, tx);
    return created;
  });
}

export async function undoPassToActual(
  userId: string,
  input: UndoPassToActualInput,
): Promise<string> {
  // Tenancy + gate (PRD §5.1, §7.5 / #9 / #10). Done OUTSIDE the transaction
  // so a rejected-undo leaves no writes behind.
  const actual = await findActualById(userId, input.actualId);
  if (!actual) {
    throw new ActualNotFoundOnUndoError();
  }
  if (actual.convertedFromLineId == null) {
    throw new NotUndoableError();
  }
  if (actual.editedAfterConversion) {
    throw new UndoForbiddenAfterEditError();
  }

  // Snapshot the values we need BEFORE opening the transaction so the
  // re-insert doesn't depend on the live row once the tx starts.
  const restoredId = actual.convertedFromLineId;

  // ONE transaction: re-insert the line + hard-delete the actual. If either
  // statement fails the whole tx rolls back (ARCH §5, PRD §16).
  await db.transaction(async (tx) => {
    await insertMonthLine(
      {
        id: restoredId,
        monthId: actual.monthId,
        categoryId: actual.categoryId,
        name: actual.name,
        observations: actual.observations,
        // remaining_amount = current actual.amount (PRD §7.5 — this is the
        // "money that moved" value, which the user might have changed
        // BEFORE editing the actual; if they edited it, undo is gated off).
        remainingAmount: actual.amount,
        // original_amount is the snapshot at clone/insert time
        // (PRD §7.5) — not the current actual.amount.
        originalAmount: actual.convertedLineOriginalAmount ?? actual.amount,
        // The undo'd line is always a committed line (PRD §7.5) with the
        // origin the original line had at the moment it was passed.
        kind: "committed",
        origin: actual.convertedLineOrigin ?? "cloned",
      },
      tx,
    );
    const deleted = await deleteActual(userId, actual.id, tx);
    if (!deleted) {
      // Concurrent delete raced the tx. The actual is gone now and the
      // line re-insert must roll back too — surface a not-found.
      throw new ActualNotFoundOnUndoError();
    }
  });

  return restoredId;
}

// Exported so the integration tests can verify the restored shape end to
// end without re-importing from the schema.
export type { MonthFixedLine };