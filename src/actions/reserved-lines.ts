"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lineKindEnum } from "@/server/db/schema";
import { amountSchema, nonEmptyStringSchema, uuidSchema } from "@/server/validators";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { WorkspaceForbiddenError } from "@/lib/workspace-roles";
import { AmountFormatError } from "@/server/money";
import { CategoryNotFoundError } from "@/server/services/categories";
import {
  addMonthOnlyLine as serviceAdd,
  deleteMonthLine as serviceDelete,
  InactiveCategoryError,
  IncomeCategoryError,
  MonthLineNotFoundError,
  MonthNotFoundError,
  updateRemainingAmount as serviceUpdate,
} from "@/server/services/reserved-lines";

// ============================================================================
// Reserved lines server actions (UC-09, ADR-6).
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

const observationsSchema = z
  .union([z.string().max(500), z.null()])
  .optional();

const kindSchema = z.enum(lineKindEnum.enumValues);

const updateRemainingSchema = z.object({
  lineId: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  remainingAmount: amountSchema,
});

const addMonthOnlySchema = z.object({
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: observationsSchema,
  amount: amountSchema,
  kind: kindSchema,
});

const deleteSchema = z.object({
  lineId: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

// Stable error codes — the client maps these to i18n keys.
export type ReservedLineActionError =
  | "incomeCategory"
  | "inactiveCategory"
  | "categoryNotFound"
  | "monthLineNotFound"
  | "monthNotFound"
  | "amountFormat"
  | "validation"
  | "workspaceForbidden";

export type ReservedLineActionResult =
  | { ok: true }
  | { ok: false; error: ReservedLineActionError };

export async function updateRemainingAmountAction(input: {
  lineId: string;
  monthId: string;
  year: number;
  month: number;
  remainingAmount: string;
}): Promise<ReservedLineActionResult> {
  const parsed = updateRemainingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const access = await resolveActiveWorkspace(locale);
  try {
    await serviceUpdate(access, {
      lineId: parsed.data.lineId,
      remainingAmount: parsed.data.remainingAmount,
    });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
    if (err instanceof MonthLineNotFoundError) {
      return { ok: false, error: "monthLineNotFound" };
    }
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

export async function addMonthOnlyLineAction(input: {
  monthId: string;
  year: number;
  month: number;
  categoryId: string;
  name: string;
  observations?: string | null;
  amount: string;
  kind: "committed" | "estimated";
}): Promise<ReservedLineActionResult> {
  const parsed = addMonthOnlySchema.safeParse(input);
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
      observations: parsed.data.observations ?? null,
      amount: parsed.data.amount,
      kind: parsed.data.kind,
    });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
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

export async function deleteMonthLineAction(input: {
  lineId: string;
  monthId: string;
  year: number;
  month: number;
}): Promise<ReservedLineActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const access = await resolveActiveWorkspace(locale);
  try {
    await serviceDelete(access, { lineId: parsed.data.lineId });
  } catch (err) {
    if (err instanceof WorkspaceForbiddenError) {
      return { ok: false, error: "workspaceForbidden" };
    }
    if (err instanceof MonthLineNotFoundError) {
      return { ok: false, error: "monthLineNotFound" };
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
