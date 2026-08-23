import "server-only";
import { db } from "@/server/db/client";
import type { MonthActualExpense } from "@/server/db/schema";
import { AmountFormatError, formatCents, parseAmount } from "@/server/money";
import { findCategoryById } from "@/server/repositories/category";
import { findMonthById } from "@/server/repositories/month";
import {
  deleteActual as repoDelete,
  findActualById,
  insertActual,
  listActualsForMonthForUser,
  updateActual as repoUpdate,
} from "@/server/repositories/actual";
import { CategoryNotFoundError } from "@/server/services/categories";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Actual expenses service (UC-08, PRD §6.7 / §7.2 / §7.3 / C15 / UC-10 /
// UC-16, ARCH §5 rule 3).
//
// Owns the CRUD domain rules for the month-scoped `month_actual_expense`
// rows (real expense tickets). SQL lives only in the repository (ARCH §5
// rule 1); transactions live here (none today — every mutation is a single
// statement — but the `Tx` plumbing stays so future atomic ops are trivial
// to add).
//
// Domain rules:
//   - The category must be an ACTIVE EXPENSE-kind category at create/edit
//     time (PRD §6.7). Income-kind → `IncomeCategoryError`; inactive
//     (soft-deleted) → `InactiveCategoryError`; missing →
//     `CategoryNotFoundError` (reused from the categories service so the
//     action layer maps one i18n key across both surfaces).
//   - Tenancy: every call resolves the parent month (or row) against
//     `month.user_id` BEFORE touching the row (PRD §5.1). A missing month
//     surfaces as `MonthNotFoundError`; a missing actual row surfaces as
//     `ActualNotFoundError` — both before the user can pick a category.
//   - Hard delete only (PRD C15 / §13) — `deleteActual` returns `true` on
//     success and `false` when the row was already gone (so the service
//     layer maps the latter to `ActualNotFoundError`).
//   - `name` is free text (PRD C13); `amount` is mandatory; `observations`
//     is OPTIONAL (PRD §6.7). Amount may be negative (PRD UC-16).
//   - Adding a ticket NEVER mutates any `month_fixed_line.remaining_amount`
//     (PRD §7.2 / §7.3) — there is no auto-balance envelope rule.
//   - Editing ALWAYS sets `edited_after_conversion = true` (PRD §7.5). This
//     is the undo gate UC-10 keys off: the moment a user touches a
//     converted ticket, undo is suppressed. The repo signature enforces the
//     rule — the service cannot forget to set it.
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class ActualNotFoundError extends Error {
  readonly code = "actual_not_found" as const;
  constructor() {
    super("Actual not found for this tenant");
    this.name = "ActualNotFoundError";
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
    super("Actuals can only target expense categories");
    this.name = "IncomeCategoryError";
  }
}

export class InactiveCategoryError extends Error {
  readonly code = "inactive_category" as const;
  constructor() {
    super("Actuals cannot target inactive (soft-deleted) categories");
    this.name = "InactiveCategoryError";
  }
}

export interface AddActualInput {
  monthId: string;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
}

export interface EditActualInput {
  id: string;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function addActual(
  userId: string,
  input: AddActualInput,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense> {
  const cents = parseAmountOrThrow(input.amount);
  // Tenancy pre-flight (PRD §5.1): the month must belong to this tenant
  // BEFORE we touch its actuals.
  const monthRow = await findMonthById(userId, input.monthId, tx);
  if (!monthRow) {
    throw new MonthNotFoundError();
  }
  await assertExpenseCategory(userId, input.categoryId, tx);
  return insertActual(
    {
      monthId: monthRow.id,
      categoryId: input.categoryId,
      name: input.name,
      observations: normaliseObservations(input.observations),
      amount: formatCents(cents),
    },
    tx,
  );
}

export async function editActual(
  userId: string,
  input: EditActualInput,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense> {
  const cents = parseAmountOrThrow(input.amount);
  // The repo's JOIN on `month.user_id` is the tenancy gate for edit/delete
  // (PRD §5.1). A null result means either the row never existed or the
  // parent month belongs to another tenant — surface as not-found in both
  // cases (don't leak the difference).
  const existing = await findActualById(userId, input.id, tx);
  if (!existing) {
    throw new ActualNotFoundError();
  }
  await assertExpenseCategory(userId, input.categoryId, tx);
  const updated = await repoUpdate(
    userId,
    input.id,
    {
      categoryId: input.categoryId,
      name: input.name,
      observations: normaliseObservations(input.observations),
      amount: formatCents(cents),
    },
    tx,
  );
  if (!updated) {
    // Concurrent delete raced the update; the row is gone now.
    throw new ActualNotFoundError();
  }
  return updated;
}

export async function deleteActual(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<void> {
  const removed = await repoDelete(userId, input.id, tx);
  if (!removed) {
    throw new ActualNotFoundError();
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listActualsForMonth(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthActualExpense[]> {
  return listActualsForMonthForUser(userId, monthId, tx);
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
