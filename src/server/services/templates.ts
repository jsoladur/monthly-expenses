import "server-only";
import { db } from "@/server/db/client";
import { AmountFormatError, formatCents, parseAmount } from "@/server/money";
import type { LineKind, Template } from "@/server/db/schema";
import {
  deactivateTemplate as repoDeactivate,
  deleteTemplate as repoDelete,
  findTemplateById,
  insertTemplate,
  listActiveTemplates as listActiveTemplatesFromRepo,
  listActiveTemplatesByKind as listActiveTemplatesByKindFromRepo,
  listTemplates,
  listTemplatesByKind,
  reactivateTemplate as repoReactivate,
  updateTemplate as repoUpdate,
} from "@/server/repositories/template";
import { findCategoryById } from "@/server/repositories/category";
import { CategoryNotFoundError } from "@/server/services/categories";
import type { Tx } from "@/server/repositories/user";
import { normalizeMonths } from "@/lib/template-schedule";
import { normalizeEndMonth, type EndMonth } from "@/lib/template-end";

export {
  EmptyScheduleError,
  InvalidScheduleError,
  appliesToMonth,
  normalizeMonths,
} from "@/lib/template-schedule";
export {
  EndMonthOnEstimatedError,
  InvalidEndMonthError,
  normalizeEndMonth,
} from "@/lib/template-end";

// ============================================================================
// Templates service (UC-05, PRD §6.3 / §7.4 / §13, ARCH §5 rule 3).
//
// Owns the domain rules for the per-user catalog of fixed (committed) and
// estimated templates. SQL lives only in the repository (ARCH §5 rule 1);
// transactions live here (none today — every mutation is a single statement
// — but the `Tx` plumbing stays so future atomic ops are trivial to add).
//
// Domain rules (PRD §6.3):
//   - Templates are expense-only. INCOME category → `IncomeCategoryError`.
//   - The category must be ACTIVE. Soft-deleted → `InactiveCategoryError`.
//   - Amount arrives as a wire string and is converted to integer cents on
//     entry (ADR-5, ARCH §8). Negative amounts are allowed (PRD §7.6).
//   - Editing a template never rewrites any month row (PRD §7.8) — this is
//     implicit because the service only touches `template`; verified in the
//     integration test that snapshots month row counts around a CRUD cycle.
//   - Inactive templates are excluded from `listActiveTemplates*` so UC-06
//     cloning never picks them up (PRD §6.3 / C17).
//   - Month schedule (PRD C23, UC-20): `months` is NULL (every month) or the
//     sorted unique month-numbers 1-12. `normalizeMonths` collapses "all 12"
//     to NULL and rejects an empty schedule.
//   - Hard delete (PRD C23 / §13, UC-20) removes the row; existing months
//     keep their cloned copies.
//   - Last payment month (PRD C29, UC-29): optional, COMMITTED only. Saving
//     it never deactivates anything — `createMonth` does that when a month on
//     or after it is created. Reactivating clears it.
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class IncomeCategoryError extends Error {
  readonly code = "income_category" as const;
  constructor() {
    super("Templates can only target expense categories");
    this.name = "IncomeCategoryError";
  }
}

export class InactiveCategoryError extends Error {
  readonly code = "inactive_category" as const;
  constructor() {
    super("Templates cannot target inactive (soft-deleted) categories");
    this.name = "InactiveCategoryError";
  }
}

export class TemplateNotFoundError extends Error {
  readonly code = "template_not_found" as const;
  constructor() {
    super("Template not found for this tenant");
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateAlreadyInactiveError extends Error {
  readonly code = "template_already_inactive" as const;
  constructor() {
    super("Template is already inactive");
    this.name = "TemplateAlreadyInactiveError";
  }
}

export class TemplateAlreadyActiveError extends Error {
  readonly code = "template_already_active" as const;
  constructor() {
    super("Template is already active");
    this.name = "TemplateAlreadyActiveError";
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listTemplatesForManagement(
  userId: string,
  kind: LineKind | undefined,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  if (kind) {
    return listTemplatesByKind(userId, kind, { includeInactive: true }, tx);
  }
  return listTemplates(userId, { includeInactive: true }, tx);
}

export async function listActiveTemplates(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listActiveTemplatesFromRepo(userId, tx);
}

export async function listActiveTemplatesByKind(
  userId: string,
  kind: LineKind,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listActiveTemplatesByKindFromRepo(userId, kind, tx);
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export interface TemplateInput {
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
  kind: LineKind;
  months?: readonly number[] | null;
  endMonth?: EndMonth | null;
}

export async function createTemplate(
  userId: string,
  input: TemplateInput,
  tx: Tx | typeof db = db,
): Promise<Template> {
  const amount = parseAmountOrThrow(input.amount);
  const months = normalizeMonths(input.months);
  const end = normalizeEndMonth(input.kind, input.endMonth);
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

  return insertTemplate(
    {
      userId,
      categoryId: input.categoryId,
      name: input.name,
      observations: input.observations ?? null,
      amount: formatCents(amount),
      kind: input.kind,
      months,
      endYear: end?.year ?? null,
      endMonth: end?.month ?? null,
      active: true,
    },
    tx,
  );
}

export async function updateTemplate(
  userId: string,
  input: TemplateInput & { id: string },
  tx: Tx | typeof db = db,
): Promise<Template> {
  const amount = parseAmountOrThrow(input.amount);
  const months = normalizeMonths(input.months);
  const end = normalizeEndMonth(input.kind, input.endMonth);
  const existing = await findTemplateById(userId, input.id, tx);
  if (!existing) {
    throw new TemplateNotFoundError();
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
      amount: formatCents(amount),
      kind: input.kind,
      months,
      endYear: end?.year ?? null,
      endMonth: end?.month ?? null,
    },
    tx,
  );
  if (!updated) {
    // The repo WHERE clause also filters by userId+id; if a concurrent
    // request deleted the row, surface as not-found.
    throw new TemplateNotFoundError();
  }
  return updated;
}

export async function deactivateTemplate(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Template> {
  const existing = await findTemplateById(userId, input.id, tx);
  if (!existing) {
    throw new TemplateNotFoundError();
  }
  if (!existing.active) {
    throw new TemplateAlreadyInactiveError();
  }
  const updated = await repoDeactivate(userId, input.id, tx);
  if (!updated) {
    throw new TemplateAlreadyInactiveError();
  }
  return updated;
}

export async function reactivateTemplate(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Template> {
  const existing = await findTemplateById(userId, input.id, tx);
  if (!existing) {
    throw new TemplateNotFoundError();
  }
  if (existing.active) {
    throw new TemplateAlreadyActiveError();
  }
  const updated = await repoReactivate(userId, input.id, tx);
  if (!updated) {
    throw new TemplateAlreadyActiveError();
  }
  return updated;
}

export async function deleteTemplate(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Template> {
  const deleted = await repoDelete(userId, input.id, tx);
  if (!deleted) {
    throw new TemplateNotFoundError();
  }
  return deleted;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// The wire format is locked by PRD C9 (`^-?\d{1,12}\.\d{2}$`) and the
// server-side `amountSchema` in `validators.ts`. The server action also
// runs the Zod check first, so this function is defense in depth — it MUST
// throw the same `AmountFormatError` so callers see one error type.
function parseAmountOrThrow(amount: string): number {
  try {
    return parseAmount(amount);
  } catch (err) {
    if (err instanceof AmountFormatError) throw err;
    throw err;
  }
}
