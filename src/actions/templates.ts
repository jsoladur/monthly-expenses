"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lineKindEnum } from "@/server/db/schema";
import { amountSchema, nonEmptyStringSchema, uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import { AmountFormatError } from "@/server/money";
import { CategoryNotFoundError } from "@/server/services/categories";
import {
  InactiveCategoryError,
  IncomeCategoryError,
  TemplateAlreadyActiveError,
  TemplateAlreadyInactiveError,
  TemplateNotFoundError,
  createTemplate as serviceCreate,
  deactivateTemplate as serviceDeactivate,
  reactivateTemplate as serviceReactivate,
  updateTemplate as serviceUpdate,
} from "@/server/services/templates";

// ============================================================================
// Templates server actions (UC-05, ADR-6).
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
//   4. `revalidatePath` invalidates the templates page on success. We
//      revalidate the dynamic route pattern so both locales' caches drop.
//
// `revalidatePath("/[locale]/templates", "page")` matches every concrete
// `/<locale>/templates` URL. The dynamic-segment + `type: "page"` form is
// the documented Next.js pattern.
// ============================================================================

const kindSchema = z.enum(lineKindEnum.enumValues);

const createSchema = z.object({
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: nonEmptyStringSchema.max(500).optional(),
  amount: amountSchema,
  kind: kindSchema,
});

const updateSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  name: nonEmptyStringSchema.max(80),
  observations: nonEmptyStringSchema.max(500).optional(),
  amount: amountSchema,
  kind: kindSchema,
});

const idSchema = z.object({
  id: uuidSchema,
});

// Stable error codes — the client maps these to i18n keys.
export type TemplateActionError =
  | "incomeCategory"
  | "inactiveCategory"
  | "notFound"
  | "alreadyInactive"
  | "alreadyActive"
  | "amountFormat"
  | "validation";

export type TemplateActionResult =
  | { ok: true }
  | { ok: false; error: TemplateActionError };

export async function createTemplateAction(input: {
  categoryId: string;
  name: string;
  observations?: string;
  amount: string;
  kind: "committed" | "estimated";
}): Promise<TemplateActionResult> {
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
      amount: parsed.data.amount,
      kind: parsed.data.kind,
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
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidatePath("/[locale]/templates", "page");
  return { ok: true };
}

export async function updateTemplateAction(input: {
  id: string;
  categoryId: string;
  name: string;
  observations?: string;
  amount: string;
  kind: "committed" | "estimated";
}): Promise<TemplateActionResult> {
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
      amount: parsed.data.amount,
      kind: parsed.data.kind,
    });
  } catch (err) {
    if (err instanceof IncomeCategoryError) {
      return { ok: false, error: "incomeCategory" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    if (err instanceof TemplateNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof AmountFormatError) {
      return { ok: false, error: "amountFormat" };
    }
    throw err;
  }
  revalidatePath("/[locale]/templates", "page");
  return { ok: true };
}

export async function deactivateTemplateAction(input: {
  id: string;
}): Promise<TemplateActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceDeactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof TemplateAlreadyInactiveError) {
      return { ok: false, error: "alreadyInactive" };
    }
    throw err;
  }
  revalidatePath("/[locale]/templates", "page");
  return { ok: true };
}

export async function reactivateTemplateAction(input: {
  id: string;
}): Promise<TemplateActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceReactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof TemplateAlreadyActiveError) {
      return { ok: false, error: "alreadyActive" };
    }
    if (err instanceof InactiveCategoryError) {
      return { ok: false, error: "inactiveCategory" };
    }
    throw err;
  }
  revalidatePath("/[locale]/templates", "page");
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
