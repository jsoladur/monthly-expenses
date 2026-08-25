"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nonEmptyStringSchema, uuidSchema, monthSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import { CategoryNotFoundError } from "@/server/services/categories";
import {
  InactiveCategoryError,
  IncomeCategoryError,
  AnnualAlreadyActiveError,
  AnnualAlreadyInactiveError,
  AnnualNotFoundError,
  InvalidChargeMonthError,
  createAnnual as serviceCreate,
  deactivateAnnual as serviceDeactivate,
  reactivateAnnual as serviceReactivate,
  updateAnnual as serviceUpdate,
} from "@/server/services/annuals";

// ============================================================================
// Annuals server actions (UC-14, ADR-6).
//
// One action per mutation. Every action:
//   1. Parses the input with Zod (rejects anything else with
//      `{ ok: false, error: "validation" }`).
//   2. Resolves the tenant via `requireUserId()` — the canonical tenancy
//      check (PRD §5.1, ARCH §3.2 rule 4). The locale is read from the
//      `x-next-intl-locale` header the middleware sets, so unauthenticated
//      callers land on a locale-prefixed sign-in URL.
//   3. Calls the service. Domain errors are translated into stable i18n keys
//      in the action result so the client component renders localized copy
//      (PRD §11, ARCH §5 rule 3).
//   4. `revalidatePath` invalidates the annuals page on success. We
//      revalidate the dynamic route pattern so both locales' caches drop.
// ============================================================================

const createSchema = z.object({
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: nonEmptyStringSchema.max(500).optional(),
  chargeMonth: monthSchema,
  isDirectDebit: z.boolean(),
});

const updateSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: nonEmptyStringSchema.max(500).optional(),
  chargeMonth: monthSchema,
  isDirectDebit: z.boolean(),
});

const idSchema = z.object({
  id: uuidSchema,
});

// Stable error codes — the client maps these to i18n keys.
export type AnnualActionError =
  | "incomeCategory"
  | "inactiveCategory"
  | "notFound"
  | "alreadyInactive"
  | "alreadyActive"
  | "invalidChargeMonth"
  | "validation";

export type AnnualActionResult =
  | { ok: true }
  | { ok: false; error: AnnualActionError };

export async function createAnnualAction(input: {
  categoryId: string;
  name: string;
  observations?: string;
  chargeMonth: number;
  isDirectDebit: boolean;
}): Promise<AnnualActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceCreate(userId, {
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      observations: parsed.data.observations ?? null,
      chargeMonth: parsed.data.chargeMonth,
      isDirectDebit: parsed.data.isDirectDebit,
    });
  } catch (err) {
    if (err instanceof IncomeCategoryError) {
      return { ok: false, error: "incomeCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof InvalidChargeMonthError) {
      return { ok: false, error: "invalidChargeMonth" };
    }
    throw err;
  }
  revalidatePath("/[locale]/annuals", "page");
  return { ok: true };
}

export async function updateAnnualAction(input: {
  id: string;
  categoryId: string;
  name: string;
  observations?: string;
  chargeMonth: number;
  isDirectDebit: boolean;
}): Promise<AnnualActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceUpdate(userId, {
      id: parsed.data.id,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      observations: parsed.data.observations ?? null,
      chargeMonth: parsed.data.chargeMonth,
      isDirectDebit: parsed.data.isDirectDebit,
    });
  } catch (err) {
    if (err instanceof IncomeCategoryError) {
      return { ok: false, error: "incomeCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof AnnualNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof InvalidChargeMonthError) {
      return { ok: false, error: "invalidChargeMonth" };
    }
    throw err;
  }
  revalidatePath("/[locale]/annuals", "page");
  return { ok: true };
}

export async function deactivateAnnualAction(input: {
  id: string;
}): Promise<AnnualActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceDeactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof AnnualNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof AnnualAlreadyInactiveError) {
      return { ok: false, error: "alreadyInactive" };
    }
    throw err;
  }
  revalidatePath("/[locale]/annuals", "page");
  return { ok: true };
}

export async function reactivateAnnualAction(input: {
  id: string;
}): Promise<AnnualActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceReactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof AnnualNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof AnnualAlreadyActiveError) {
      return { ok: false, error: "alreadyActive" };
    }
    throw err;
  }
  revalidatePath("/[locale]/annuals", "page");
  return { ok: true };
}

// The edge middleware sets `x-next-intl-locale` on every request it
// processes. Server actions running from a form posted to a locale-prefixed
// page see the same header. If for some reason the header is missing (e.g.
// the action was invoked from a non-locale context), fall back to the default
// so `requireUserId()` still produces a valid sign-in redirect.
async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
