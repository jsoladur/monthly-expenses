"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { amountSchema, nonEmptyStringSchema, uuidSchema } from "@/server/validators";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { WorkspaceForbiddenError } from "@/lib/workspace-roles";
import { AmountFormatError } from "@/server/money";
import { CategoryNotFoundError } from "@/server/services/categories";
import {
  ExpenseCategoryError,
  InactiveCategoryError,
  IncomeNotFoundError,
  MonthNotFoundError,
  addIncome as serviceAdd,
  deleteIncome as serviceDelete,
  editIncome as serviceEdit,
} from "@/server/services/incomes";

// ============================================================================
// Month incomes server actions (UC-07, ADR-6).
//
// One action per mutation. Every action:
//   1. Parses the input with Zod (rejects anything else with
//      `{ ok: false, error: "validation" }`).
//   2. Resolves the active workspace via `resolveActiveWorkspace()` — session
//      (`requireUserId()`) + membership check (UC-31 §4.9, ARCH §3.2 rule 6);
//      the service applies the role matrix (`workspaceForbidden`). The locale is read from the
//      `x-next-intl-locale` header the middleware sets.
//   3. Calls the service. Domain errors are translated into stable i18n keys
//      in the action result so the client component renders localized copy
//      (PRD §11, ARCH §5 rule 3).
//   4. `revalidatePath` invalidates the active month workspace on success so
//      the row surfaces immediately. The dynamic-segment + `type: "page"`
//      form is the documented Next.js pattern.
//
// The action's locale + year/month are computed from the workspace URL the
// caller is on (passed in via the input) so revalidation targets the exact
// page the user is viewing rather than every locale/month combo.
// ============================================================================

const addSchema = z.object({
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  amount: amountSchema,
});

const editSchema = z.object({
  id: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  amount: amountSchema,
});

const deleteSchema = z.object({
  id: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

// Stable error codes — the client maps these to i18n keys.
export type IncomeActionError =
  | "expenseCategory"
  | "inactiveCategory"
  | "categoryNotFound"
  | "incomeNotFound"
  | "monthNotFound"
  | "amountFormat"
  | "validation"
  | "workspaceForbidden";

export type IncomeActionResult =
  | { ok: true }
  | { ok: false; error: IncomeActionError };

export async function addIncomeAction(input: {
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  name: string;
  amount: string;
}): Promise<IncomeActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const access = await resolveActiveWorkspace(locale);
  try {
    await serviceAdd(access, {
      monthId: parsed.data.monthId,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      amount: parsed.data.amount,
    });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
    if (err instanceof ExpenseCategoryError) {
      return { ok: false, error: "expenseCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "categoryNotFound" };
    }
    if (err instanceof MonthNotFoundError) {
      return { ok: false, error: "monthNotFound" };
    }
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

export async function editIncomeAction(input: {
  id: string;
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  name: string;
  amount: string;
}): Promise<IncomeActionResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const access = await resolveActiveWorkspace(locale);
  try {
    await serviceEdit(access, {
      id: parsed.data.id,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      amount: parsed.data.amount,
    });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
    if (err instanceof ExpenseCategoryError) {
      return { ok: false, error: "expenseCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "categoryNotFound" };
    }
    if (err instanceof IncomeNotFoundError) {
      return { ok: false, error: "incomeNotFound" };
    }
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

export async function deleteIncomeAction(input: {
  id: string;
  monthId: string;
  year: number;
  month: number;
}): Promise<IncomeActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const access = await resolveActiveWorkspace(locale);
  try {
    await serviceDelete(access, { id: parsed.data.id });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
    if (err instanceof IncomeNotFoundError) {
      return { ok: false, error: "incomeNotFound" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function revalidateMonthWorkspace(
  locale: string,
  year: number,
  month: number,
): void {
  revalidatePath(`/[locale]/months/${year}/${month}`, "page");
  // Invalidate the locale-specific URL by reading from the resolved locale.
  revalidatePath(`/${locale}/months/${year}/${month}`, "page");
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
