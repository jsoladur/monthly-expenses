import "server-only";
import { db } from "@/server/db/client";
import type { Annual } from "@/server/db/schema";
import {
  deactivateAnnual as repoDeactivate,
  findAnnualById,
  getAnnualReminders as repoGetReminders,
  insertAnnual,
  listAnnuals,
  reactivateAnnual as repoReactivate,
  updateAnnual as repoUpdate,
} from "@/server/repositories/annual";
import { findCategoryById } from "@/server/repositories/category";
import { CategoryNotFoundError } from "@/server/services/categories";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Annuals service (UC-14, ARCH §5 rule 3).
//
// Owns the domain rules for the per-user catalog of yearly recurring expense
// reminders. SQL lives only in the repository (ARCH §5 rule 1); transactions
// live here (none today — every mutation is a single statement — but the `Tx`
// plumbing stays so future atomic ops are trivial to add).
//
// Domain rules (UC-14):
//   - Annuals are expense-only. INCOME category → `IncomeCategoryError`.
//   - The category must be ACTIVE. Soft-deleted → `InactiveCategoryError`.
//   - charge_month must be 1-12 (enforced by DB CHECK, validated here too).
//   - Inactive annuals are excluded from `getAnnualReminders` so the month
//     workspace never shows reminders for soft-deleted annuals.
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class IncomeCategoryError extends Error {
  readonly code = "income_category" as const;
  constructor() {
    super("Annuals can only target expense categories");
    this.name = "IncomeCategoryError";
  }
}

export class InactiveCategoryError extends Error {
  readonly code = "inactive_category" as const;
  constructor() {
    super("Annuals cannot target inactive (soft-deleted) categories");
    this.name = "InactiveCategoryError";
  }
}

export class AnnualNotFoundError extends Error {
  readonly code = "annual_not_found" as const;
  constructor() {
    super("Annual not found for this tenant");
    this.name = "AnnualNotFoundError";
  }
}

export class AnnualAlreadyInactiveError extends Error {
  readonly code = "annual_already_inactive" as const;
  constructor() {
    super("Annual is already inactive");
    this.name = "AnnualAlreadyInactiveError";
  }
}

export class AnnualAlreadyActiveError extends Error {
  readonly code = "annual_already_active" as const;
  constructor() {
    super("Annual is already active");
    this.name = "AnnualAlreadyActiveError";
  }
}

export class InvalidChargeMonthError extends Error {
  readonly code = "invalid_charge_month" as const;
  constructor() {
    super("charge_month must be between 1 and 12");
    this.name = "InvalidChargeMonthError";
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listAnnualsForManagement(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Annual[]> {
  return listAnnuals(userId, { includeInactive: true }, tx);
}

export async function getAnnualReminders(
  userId: string,
  chargeMonth: number,
  tx: Tx | typeof db = db,
): Promise<Annual[]> {
  if (chargeMonth < 1 || chargeMonth > 12) {
    throw new InvalidChargeMonthError();
  }
  return repoGetReminders(userId, chargeMonth, tx);
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export interface AnnualInput {
  categoryId: string;
  name: string;
  observations?: string | null;
  amount?: string | null;
  chargeMonth: number;
  isDirectDebit: boolean;
}

export async function createAnnual(
  userId: string,
  input: AnnualInput,
  tx: Tx | typeof db = db,
): Promise<Annual> {
  if (input.chargeMonth < 1 || input.chargeMonth > 12) {
    throw new InvalidChargeMonthError();
  }
  const category = await findCategoryById(userId, input.categoryId, tx);
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.kind !== "expense") {
    throw new IncomeCategoryError();
  }
  if (!category.active) {
    throw new InactiveCategoryError();
  }

  return insertAnnual(
    {
      userId,
      categoryId: input.categoryId,
      name: input.name,
      observations: input.observations ?? null,
      amount: input.amount ?? null,
      chargeMonth: input.chargeMonth,
      isDirectDebit: input.isDirectDebit,
      active: true,
    },
    tx,
  );
}

export async function updateAnnual(
  userId: string,
  input: AnnualInput & { id: string },
  tx: Tx | typeof db = db,
): Promise<Annual> {
  if (input.chargeMonth < 1 || input.chargeMonth > 12) {
    throw new InvalidChargeMonthError();
  }
  const existing = await findAnnualById(userId, input.id, tx);
  if (!existing) {
    throw new AnnualNotFoundError();
  }
  const category = await findCategoryById(userId, input.categoryId, tx);
  if (!category) {
    throw new CategoryNotFoundError();
  }
  if (category.kind !== "expense") {
    throw new IncomeCategoryError();
  }
  if (!category.active) {
    throw new InactiveCategoryError();
  }

  const updated = await repoUpdate(
    userId,
    input.id,
    {
      categoryId: input.categoryId,
      name: input.name,
      observations: input.observations ?? null,
      amount: input.amount ?? null,
      chargeMonth: input.chargeMonth,
      isDirectDebit: input.isDirectDebit,
    },
    tx,
  );
  if (!updated) {
    throw new AnnualNotFoundError();
  }
  return updated;
}

export async function deactivateAnnual(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Annual> {
  const existing = await findAnnualById(userId, input.id, tx);
  if (!existing) {
    throw new AnnualNotFoundError();
  }
  if (!existing.active) {
    throw new AnnualAlreadyInactiveError();
  }
  const updated = await repoDeactivate(userId, input.id, tx);
  if (!updated) {
    throw new AnnualAlreadyInactiveError();
  }
  return updated;
}

export async function reactivateAnnual(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Annual> {
  const existing = await findAnnualById(userId, input.id, tx);
  if (!existing) {
    throw new AnnualNotFoundError();
  }
  if (existing.active) {
    throw new AnnualAlreadyActiveError();
  }
  const updated = await repoReactivate(userId, input.id, tx);
  if (!updated) {
    throw new AnnualAlreadyActiveError();
  }
  return updated;
}
