import "server-only";
import { db } from "@/server/db/client";
import { formatCents, parseAmount } from "@/server/money";
import { findMonthById } from "@/server/repositories/month";
import {
  listActualsForMonth,
  listEstimatedLinesForMonth,
} from "@/server/repositories/estimate-check";
import { updateMonthLineRemaining } from "@/server/repositories/reserved-line";
import type { Tx } from "@/server/repositories/user";
import { MonthNotFoundError } from "@/server/services/months";
import {
  computeEstimateCheck,
  planEstimateUpdates,
  type EstimateCheck,
  type EstimateCheckMode,
} from "@/lib/estimate-check";

// ============================================================================
// Estimate-check service (UC-25, proposed PRD C25; builds on §7.3 / §7.7).
//
// Shows, per expense category with estimated lines, how much is still
// reserved against the category's tickets (pass-to-actual tickets excluded)
// as a HINT of possible overlap, and applies an EXPLICIT fix
// on request. Never automatic: adding a ticket changes no remaining by
// itself (PRD §16 "Never auto-balance envelopes").
//
// `applyEstimateSuggestion` recomputes everything inside one transaction —
// client numbers are never trusted — and updates lines through the UC-09
// repository function `updateMonthLineRemaining` (single-field patch,
// tenant-joined). Committed lines and templates are never touched.
// ============================================================================

export class EstimateCategoryNotFoundError extends Error {
  readonly code = "estimate_category_not_found" as const;
  constructor() {
    super("No estimated lines for this category in this month");
    this.name = "EstimateCategoryNotFoundError";
  }
}

export interface ApplyEstimateSuggestionInput {
  monthId: string;
  categoryId: string;
  mode: EstimateCheckMode;
}

export async function getEstimateCheck(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<EstimateCheck> {
  const owned = await findMonthById(userId, monthId, tx);
  if (!owned) {
    throw new MonthNotFoundError();
  }
  const [lines, tickets] = await Promise.all([
    listEstimatedLinesForMonth(userId, monthId, tx),
    listActualsForMonth(userId, monthId, tx),
  ]);
  return computeEstimateCheck(
    lines.map((l) => ({
      id: l.id,
      categoryId: l.categoryId,
      categoryName: l.categoryName,
      name: l.name,
      originalCents: parseAmount(l.originalAmount),
      remainingCents: parseAmount(l.remainingAmount),
    })),
    tickets.map((t) => ({
      id: t.id,
      categoryId: t.categoryId,
      name: t.name,
      amountCents: parseAmount(t.amount),
      fromLine: t.convertedFromLineId !== null,
    })),
  );
}

export async function applyEstimateSuggestion(
  userId: string,
  input: ApplyEstimateSuggestionInput,
): Promise<EstimateCheck> {
  return db.transaction(async (tx) => {
    const before = await getEstimateCheck(userId, input.monthId, tx);
    const target = before.categories.find((c) => c.categoryId === input.categoryId);
    if (!target) {
      throw new EstimateCategoryNotFoundError();
    }
    for (const update of planEstimateUpdates(target, input.mode)) {
      await updateMonthLineRemaining(userId, update.id, formatCents(update.remaining), tx);
    }
    return getEstimateCheck(userId, input.monthId, tx);
  });
}
