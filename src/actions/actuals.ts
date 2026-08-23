"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { amountSchema, nonEmptyStringSchema, uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import { AmountFormatError } from "@/server/money";
import { CategoryNotFoundError } from "@/server/services/categories";
import {
  ActualNotFoundError,
  IncomeCategoryError,
  InactiveCategoryError,
  MonthNotFoundError,
  addActual as serviceAdd,
  deleteActual as serviceDelete,
  editActual as serviceEdit,
} from "@/server/services/actuals";

// ============================================================================
// Actual expenses server actions (UC-08, ADR-6).
//
// One action per mutation. Every action:
//   1. Parses the input with Zod (rejects anything else with
//      `{ ok: false, error: "validation" }`).
//   2. Resolves the tenant via `requireUserId()` — the canonical tenancy
//      check (PRD §5.1, ARCH §3.2 rule 4). The locale is read from the
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

// `observations` is optional (PRD §6.7). The wire form lets the client pass
// `null` (clears it) or a trimmed string. `z.union([z.string(), z.null()])`
// enforces that — the empty string is normalised to `null` by the service.
const observationsSchema = z
  .union([z.string().max(500), z.null()])
  .optional();

const addSchema = z.object({
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: observationsSchema,
  amount: amountSchema,
});

const editSchema = z.object({
  id: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: observationsSchema,
  amount: amountSchema,
});

const deleteSchema = z.object({
  id: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

// Stable error codes — the client maps these to i18n keys.
export type ActualActionError =
  | "incomeCategory"
  | "inactiveCategory"
  | "categoryNotFound"
  | "actualNotFound"
  | "monthNotFound"
  | "amountFormat"
  | "validation";

export type ActualActionResult =
  | { ok: true }
  | { ok: false; error: ActualActionError };

export async function addActualAction(input: {
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
}): Promise<ActualActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await serviceAdd(userId, {
      monthId: parsed.data.monthId,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      observations: parsed.data.observations ?? null,
      amount: parsed.data.amount,
    });
  } catch (err) {
    if (err instanceof IncomeCategoryError) {
      return { ok: false, error: "incomeCategory" };
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

export async function editActualAction(input: {
  id: string;
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
}): Promise<ActualActionResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await serviceEdit(userId, {
      id: parsed.data.id,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      observations: parsed.data.observations ?? null,
      amount: parsed.data.amount,
    });
  } catch (err) {
    if (err instanceof IncomeCategoryError) {
      return { ok: false, error: "incomeCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "categoryNotFound" };
    }
    if (err instanceof ActualNotFoundError) {
      return { ok: false, error: "actualNotFound" };
    }
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

export async function deleteActualAction(input: {
  id: string;
  monthId: string;
  year: number;
  month: number;
}): Promise<ActualActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await serviceDelete(userId, { id: parsed.data.id });
  } catch (err) {
    if (err instanceof ActualNotFoundError) {
      return { ok: false, error: "actualNotFound" };
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
