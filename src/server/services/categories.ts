import "server-only";
import { db } from "@/server/db/client";
import type { Category, CategoryKind } from "@/server/db/schema";
import {
  deactivateCategory as repoDeactivate,
  findCategoryById,
  insertCategory,
  listActiveCategories,
  listCategories,
  reactivateCategory as repoReactivate,
  updateCategoryName as repoRename,
} from "@/server/repositories/category";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Categories service (UC-03, PRD §6.2 / §13, ARCH §5 rule 3).
//
// Owns the domain rules for the global per-user catalog of expense & income
// categories. SQL lives only in the repository (ARCH §5 rule 1); transactions
// live here (none today — every mutation is a single statement — but the
// `Tx` plumbing stays so future atomic ops are trivial to add).
//
// Domain errors are exported as named classes. Server actions translate them
// into i18n keys at the boundary; this layer must NOT depend on next-intl so
// the service stays unit-testable without a React tree.
// ============================================================================

export class DuplicateCategoryNameError extends Error {
  readonly code = "duplicate_category_name" as const;
  constructor() {
    super("An active category with this name already exists for this kind");
    this.name = "DuplicateCategoryNameError";
  }
}

export class CategoryNotFoundError extends Error {
  readonly code = "category_not_found" as const;
  constructor() {
    super("Category not found for this tenant");
    this.name = "CategoryNotFoundError";
  }
}

export class CategoryAlreadyInactiveError extends Error {
  readonly code = "category_already_inactive" as const;
  constructor() {
    super("Category is already inactive");
    this.name = "CategoryAlreadyInactiveError";
  }
}

export class CategoryAlreadyActiveError extends Error {
  readonly code = "category_already_active" as const;
  constructor() {
    super("Category is already active");
    this.name = "CategoryAlreadyActiveError";
  }
}

const CATEGORY_ACTIVE_NAME_CONSTRAINT = "category_active_name_uk";

// Postgres 23505 = unique_violation. Only the partial unique index on
// `category(user_id, kind, name) WHERE active` can fire today, but we still
// verify the constraint name so a future schema addition cannot accidentally
// surface as "duplicate category name".
//
// Drizzle wraps the underlying postgres-js error in `DrizzleQueryError`
// (with the original attached as `.cause`), so we walk the cause chain.
function isCategoryActiveNameUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") return false;
    const e = current as {
      code?: string;
      constraint_name?: string;
      constraint?: string;
      message?: string;
      cause?: unknown;
    };
    if (e.code === "23505") {
      const explicitName = e.constraint_name ?? e.constraint ?? "";
      if (explicitName) {
        return explicitName === CATEGORY_ACTIVE_NAME_CONSTRAINT;
      }
      if (
        typeof e.message === "string" &&
        e.message.includes(CATEGORY_ACTIVE_NAME_CONSTRAINT)
      ) {
        return true;
      }
      return false;
    }
    current = e.cause;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function listCategoriesForManagement(
  userId: string,
  kind: CategoryKind,
  tx: Tx | typeof db = db,
): Promise<Category[]> {
  return listCategories(userId, kind, { includeInactive: true }, tx);
}

export async function listActiveCategoriesForPicker(
  userId: string,
  kind: CategoryKind,
  tx: Tx | typeof db = db,
): Promise<Category[]> {
  return listActiveCategories(userId, kind, tx);
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function createCategory(
  userId: string,
  input: { kind: CategoryKind; name: string },
  tx: Tx | typeof db = db,
): Promise<Category> {
  try {
    return await insertCategory(
      { userId, kind: input.kind, name: input.name, active: true },
      tx,
    );
  } catch (err) {
    if (isCategoryActiveNameUniqueViolation(err)) {
      throw new DuplicateCategoryNameError();
    }
    throw err;
  }
}

export async function renameCategory(
  userId: string,
  input: { id: string; name: string },
  tx: Tx | typeof db = db,
): Promise<Category> {
  const existing = await findCategoryById(userId, input.id, tx);
  if (!existing) {
    throw new CategoryNotFoundError();
  }
  if (existing.name === input.name) {
    // Idempotent: nothing to do. Skip the UPDATE so we don't waste a round
    // trip and don't trip the partial unique index in the edge case where
    // a soft-deleted row with the new name already exists.
    return existing;
  }
  try {
    const updated = await repoRename(userId, input.id, input.name, tx);
    if (!updated) {
      throw new CategoryNotFoundError();
    }
    return updated;
  } catch (err) {
    if (isCategoryActiveNameUniqueViolation(err)) {
      throw new DuplicateCategoryNameError();
    }
    throw err;
  }
}

export async function deactivateCategory(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Category> {
  const existing = await findCategoryById(userId, input.id, tx);
  if (!existing) {
    throw new CategoryNotFoundError();
  }
  if (!existing.active) {
    throw new CategoryAlreadyInactiveError();
  }
  const updated = await repoDeactivate(userId, input.id, tx);
  if (!updated) {
    // The repo's WHERE clause also requires `active = true`; if the row was
    // raced by another request, treat as already-inactive.
    throw new CategoryAlreadyInactiveError();
  }
  return updated;
}

export async function reactivateCategory(
  userId: string,
  input: { id: string },
  tx: Tx | typeof db = db,
): Promise<Category> {
  const existing = await findCategoryById(userId, input.id, tx);
  if (!existing) {
    throw new CategoryNotFoundError();
  }
  if (existing.active) {
    throw new CategoryAlreadyActiveError();
  }
  try {
    const updated = await repoReactivate(userId, input.id, tx);
    if (!updated) {
      throw new CategoryAlreadyActiveError();
    }
    return updated;
  } catch (err) {
    if (isCategoryActiveNameUniqueViolation(err)) {
      throw new DuplicateCategoryNameError();
    }
    throw err;
  }
}
