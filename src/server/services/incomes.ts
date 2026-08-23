import "server-only";
import { db } from "@/server/db/client";
import type { MonthIncome } from "@/server/db/schema";
import { AmountFormatError, formatCents, parseAmount } from "@/server/money";
import {
  deleteIncome as repoDelete,
  findIncomeById,
  insertIncome,
  listIncomesForMonth as repoListIncomesForMonth,
  updateIncome as repoUpdate,
} from "@/server/repositories/income";
import { findCategoryById } from "@/server/repositories/category";
import { findMonthById } from "@/server/repositories/month";
import { CategoryNotFoundError } from "@/server/services/categories";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Month incomes service (UC-07, PRD §6.5 / §7.8 / C15, ARCH §5 rule 3).
//
// Owns the CRUD domain rules for the month-scoped `month_income` rows.
// SQL lives only in the repository (ARCH §5 rule 1); transactions live here
// (none today — every mutation is a single statement — but the `Tx`
// plumbing stays so future atomic ops are trivial to add).
//
// Domain rules:
//   - The category must be an ACTIVE INCOME-kind category at create/edit
//     time (PRD §6.5). Expense-kind → `ExpenseCategoryError`; inactive
//     (soft-deleted) → `InactiveCategoryError`; missing →
//     `CategoryNotFoundError` (reused from the categories service so the
//     action layer maps one i18n key across both surfaces).
//   - Tenancy: every call resolves the parent month (or row) against
//     `month.user_id` BEFORE touching the row (PRD §5.1). A missing month
//     surfaces as `MonthNotFoundError`; a missing income row surfaces as
//     `IncomeNotFoundError` — both before the user can pick a category.
//   - Hard delete only (PRD C15 / §13) — `deleteIncome` returns `true` on
//     success and `false` when the row was already gone (so the service
//     layer maps the latter to `IncomeNotFoundError`).
//   - Incomes never clone from templates (PRD §7.8); this service only
//     touches `month_income`, never `template` or `month_fixed_line`.
//   - `name` and `amount` are mandatory; there is NO observations field on
//     `month_income` (PRD §6.5). Amount may be negative (PRD UC-16).
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class IncomeNotFoundError extends Error {
  readonly code = "income_not_found" as const;
  constructor() {
    super("Income not found for this tenant");
    this.name = "IncomeNotFoundError";
  }
}

export class MonthNotFoundError extends Error {
  readonly code = "month_not_found" as const;
  constructor() {
    super("Month not found for this tenant");
    this.name = "MonthNotFoundError";
  }
}

export class ExpenseCategoryError extends Error {
  readonly code = "expense_category" as const;
  constructor() {
    super("Incomes can only target income categories");
    this.name = "ExpenseCategoryError";
  }
}

export class InactiveCategoryError extends Error {
  readonly code = "inactive_category" as const;
  constructor() {
    super("Incomes cannot target inactive (soft-deleted) categories");
    this.name = "InactiveCategoryError";
  }
}

export interface AddIncomeInput {
  monthId: string;
  categoryId: string;
  name: string;
  amount: string;
}

export interface EditIncomeInput {
  id: string;
  categoryId: string;
  name: string;
  amount: string;
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function addIncome(
  userId: string,
  input: AddIncomeInput,
  tx: Tx | typeof db = db,
): Promise<MonthIncome> {
  const cents = parseAmountOrThrow(input.amount);
  // Tenancy pre-flight (PRD §5.1): the month must belong to this tenant
  // BEFORE we touch its incomes.
  const monthRow = await findMonthById(userId, input.monthId, tx);
  if (!monthRow) {
    throw new MonthNotFoundError();
  }
  await assertIncomeCategory(userId, input.categoryId, tx);
  return insertIncome(
    {
      monthId: monthRow.id,
      categoryId: input.categoryId,
      name: input.name,
      amount: formatCents(cents),
    },
    tx,
  );
}

export async function editIncome(
  userId: string,
  input: EditIncomeInput,
  tx: Tx | typeof db = db,
): Promise<MonthIncome> {
  const cents = parseAmountOrThrow(input.amount);
  // The repo's JOIN on `month.user_id` is the tenancy gate for edit/delete
  // (PRD §5.1). A null result means either the row never existed or the
  // parent month belongs to another tenant — surface as not-found in both
  // cases (don't leak the difference).
  const existing = await findIncomeById(userId, input.id, tx);
  if (!existing) {
    throw new IncomeNotFoundError();
  }
  await assertIncomeCategory(userId, input.categoryId, tx);
  const updated = await repoUpdate(
    userId,
    input.id,
    {
      categoryId: input.categoryId,
      name: input.name,
      amount: formatCents(cents),
    },
    tx,
  );
  if (!updated) {
    // Concurrent delete raced the update; the row is gone now.
    throw new IncomeNotFoundError();
  }
  return updated;
}

export async function deleteIncome(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<void> {
  const removed = await repoDelete(userId, input.id, tx);
  if (!removed) {
    throw new IncomeNotFoundError();
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listIncomesForMonth(
  userId: string,
  monthId: string,
  tx: Tx | typeof db = db,
): Promise<MonthIncome[]> {
  return repoListIncomesForMonth(userId, monthId, tx);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function assertIncomeCategory(
  userId: string,
  categoryId: string,
  tx: Tx | typeof db,
): Promise<void> {
  const category = await findCategoryById(userId, categoryId, tx);
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.kind !== "income") {
    throw new ExpenseCategoryError();
  }
  if (!category.active) {
    throw new InactiveCategoryError();
  }
}

function parseAmountOrThrow(amount: string): number {
  try {
    return parseAmount(amount);
  } catch (err) {
    if (err instanceof AmountFormatError) throw err;
    throw err;
  }
}
