import "server-only";
import { db } from "@/server/db/client";
import type {
  LineKind,
  MonthFixedLine,
} from "@/server/db/schema";
import { AmountFormatError, formatCents, parseAmount } from "@/server/money";
import { findCategoryById } from "@/server/repositories/category";
import { findMonthById } from "@/server/repositories/month";
import {
  deleteMonthLine as repoDelete,
  findMonthLineById,
  insertMonthLine,
  updateMonthLineRemaining as repoUpdateRemaining,
} from "@/server/repositories/reserved-line";
import { CategoryNotFoundError } from "@/server/services/categories";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Reserved-lines service (UC-09, PRD §6.6 / §7.3 / §7.8 / §13 / UC-11 / UC-18,
// ARCH §5 rule 3).
//
// Owns the domain rules for the month-scoped `month_fixed_line` rows after
// the one-time clone at month creation (UC-06). SQL lives only in the
// repository (ARCH §5 rule 1); transactions live here (none today — every
// mutation is a single statement — but the `Tx` plumbing stays so future
// atomic ops — UC-10's pass-to-actual — are trivial to add).
//
// Domain rules:
//   - Manual remaining edits are allowed for BOTH `committed` AND `estimated`
//     lines (PRD §6.6 / §7.4). Zero and negative values are accepted
//     (PRD §7.4). The patch is single-field: `remaining_amount` is updated;
//     `original_amount` (the snapshot at clone / insert time) is NEVER
//     touched (PRD §6.6). The repo signature enforces the single-field
//     rule.
//   - Month-only lines live ONLY on their instance (PRD §6.6 / §7.8 / UC-18):
//     `origin = 'month_only'`, `remaining_amount = original_amount = amount`
//     at insert. The next month's clone ignores them unless they were added
//     to the templates before that month is created (PRD §7.8) — that
//     behavior is the responsibility of UC-06's clone source, not this
//     service.
//   - The category on a month-only line must be ACTIVE EXPENSE-kind
//     (PRD §6.6). Income-kind → `IncomeCategoryError`; inactive (soft-
//     deleted) → `InactiveCategoryError`; missing → `CategoryNotFoundError`
//     (reused from the categories service so the action layer maps one
//     i18n key across both surfaces).
//   - Tenancy: every call resolves the parent month (or row) against
//     `month.user_id` BEFORE touching the row (PRD §5.1). A missing month
//     surfaces as `MonthNotFoundError`; a missing line surfaces as
//     `MonthLineNotFoundError` — both before the user can pick a category.
//   - Hard delete only (PRD C15 / §13) — `deleteMonthLine` returns `true`
//     on success and `false` when the row was already gone (so the service
//     maps the latter to `MonthLineNotFoundError`).
//   - Editing a remaining NEVER creates an actual ticket (PRD §7.3, UC-11).
//   - Editing a remaining NEVER mutates a template row (PRD §6.6 / §7.8) —
//     implicit because the service only touches `month_fixed_line`.
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class MonthLineNotFoundError extends Error {
  readonly code = "month_line_not_found" as const;
  constructor() {
    super("Reserved line not found for this tenant");
    this.name = "MonthLineNotFoundError";
  }
}

export class MonthNotFoundError extends Error {
  readonly code = "month_not_found" as const;
  constructor() {
    super("Month not found for this tenant");
    this.name = "MonthNotFoundError";
  }
}

export class IncomeCategoryError extends Error {
  readonly code = "income_category" as const;
  constructor() {
    super("Reserved lines can only target expense categories");
    this.name = "IncomeCategoryError";
  }
}

export class InactiveCategoryError extends Error {
  readonly code = "inactive_category" as const;
  constructor() {
    super("Reserved lines cannot target inactive (soft-deleted) categories");
    this.name = "InactiveCategoryError";
  }
}

export interface UpdateRemainingInput {
  lineId: string;
  remainingAmount: string;
}

export interface AddMonthOnlyLineInput {
  monthId: string;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
  kind: LineKind;
}

export interface DeleteMonthLineInput {
  lineId: string;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function updateRemainingAmount(
  userId: string,
  input: UpdateRemainingInput,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine> {
  const cents = parseAmountOrThrow(input.remainingAmount);
  // The repo's JOIN on `month.user_id` is the tenancy gate (PRD §5.1). A
  // null result means either the row never existed or the parent month
  // belongs to another tenant — surface as not-found in both cases (don't
  // leak the difference).
  const existing = await findMonthLineById(userId, input.lineId, tx);
  if (!existing) {
    throw new MonthLineNotFoundError();
  }
  const updated = await repoUpdateRemaining(
    userId,
    input.lineId,
    formatCents(cents),
    tx,
  );
  if (!updated) {
    // Concurrent delete raced the update; the row is gone now.
    throw new MonthLineNotFoundError();
  }
  return updated;
}

export async function addMonthOnlyLine(
  userId: string,
  input: AddMonthOnlyLineInput,
  tx: Tx | typeof db = db,
): Promise<MonthFixedLine> {
  const cents = parseAmountOrThrow(input.amount);
  // Tenancy pre-flight (PRD §5.1): the month must belong to this tenant
  // BEFORE we touch its reserved lines.
  const monthRow = await findMonthById(userId, input.monthId, tx);
  if (!monthRow) {
    throw new MonthNotFoundError();
  }
  await assertExpenseCategory(userId, input.categoryId, tx);
  const amountString = formatCents(cents);
  return insertMonthLine(
    {
      monthId: monthRow.id,
      categoryId: input.categoryId,
      name: input.name,
      observations: normaliseObservations(input.observations),
      remainingAmount: amountString,
      originalAmount: amountString,
      kind: input.kind,
      origin: "month_only",
    },
    tx,
  );
}

export async function deleteMonthLine(
  userId: string,
  input: DeleteMonthLineInput,
  tx: Tx | typeof db = db,
): Promise<void> {
  const removed = await repoDelete(userId, input.lineId, tx);
  if (!removed) {
    throw new MonthLineNotFoundError();
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function assertExpenseCategory(
  userId: string,
  categoryId: string,
  tx: Tx | typeof db,
): Promise<void> {
  const category = await findCategoryById(userId, categoryId, tx);
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.kind !== "expense") {
    throw new IncomeCategoryError();
  }
  if (!category.active) {
    throw new InactiveCategoryError();
  }
}

function normaliseObservations(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseAmountOrThrow(amount: string): number {
  try {
    return parseAmount(amount);
  } catch (err) {
    if (err instanceof AmountFormatError) throw err;
    throw err;
  }
}
