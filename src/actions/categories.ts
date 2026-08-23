"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { categoryKindEnum } from "@/server/db/schema";
import { nonEmptyStringSchema, uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  CategoryAlreadyActiveError,
  CategoryAlreadyInactiveError,
  CategoryNotFoundError,
  DuplicateCategoryNameError,
  createCategory as serviceCreate,
  deactivateCategory as serviceDeactivate,
  reactivateCategory as serviceReactivate,
  renameCategory as serviceRename,
} from "@/server/services/categories";

// ============================================================================
// Categories server actions (UC-03, ADR-6).
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
//   4. `revalidatePath` invalidates the categories page on success. We
//      revalidate the dynamic route pattern so both locales' caches drop.
//
// `revalidatePath("/[locale]/categories", "page")` matches every concrete
// `/<locale>/categories` URL. The dynamic-segment + `type: "page"` form is
// the documented Next.js pattern (see `node_modules/next/dist/docs/.../revalidatePath.md`).
// ============================================================================

const kindSchema = z.enum(categoryKindEnum.enumValues);
const nameSchema = nonEmptyStringSchema.max(80);

const createSchema = z.object({
  kind: kindSchema,
  name: nameSchema,
});

const renameSchema = z.object({
  id: uuidSchema,
  name: nameSchema,
});

const idSchema = z.object({
  id: uuidSchema,
});

// Stable error codes — the client maps these to i18n keys. Adding a new
// error means: extend the union AND extend the client switch.
export type CategoryActionError =
  | "duplicate"
  | "notFound"
  | "alreadyInactive"
  | "alreadyActive"
  | "validation";

export type CategoryActionResult =
  | { ok: true }
  | { ok: false; error: CategoryActionError };

export async function createCategoryAction(
  input: { kind: "expense" | "income"; name: string },
): Promise<CategoryActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceCreate(userId, parsed.data);
  } catch (err) {
    if (err instanceof DuplicateCategoryNameError) {
      return { ok: false, error: "duplicate" };
    }
    throw err;
  }
  revalidatePath("/[locale]/categories", "page");
  return { ok: true };
}

export async function renameCategoryAction(
  input: { id: string; name: string },
): Promise<CategoryActionResult> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceRename(userId, parsed.data);
  } catch (err) {
    if (err instanceof DuplicateCategoryNameError) {
      return { ok: false, error: "duplicate" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    throw err;
  }
  revalidatePath("/[locale]/categories", "page");
  return { ok: true };
}

export async function deactivateCategoryAction(
  input: { id: string },
): Promise<CategoryActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceDeactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof CategoryAlreadyInactiveError) {
      return { ok: false, error: "alreadyInactive" };
    }
    throw err;
  }
  revalidatePath("/[locale]/categories", "page");
  return { ok: true };
}

export async function reactivateCategoryAction(
  input: { id: string },
): Promise<CategoryActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceReactivate(userId, parsed.data);
  } catch (err) {
    if (err instanceof DuplicateCategoryNameError) {
      return { ok: false, error: "duplicate" };
    }
    if (err instanceof CategoryNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (err instanceof CategoryAlreadyActiveError) {
      return { ok: false, error: "alreadyActive" };
    }
    throw err;
  }
  revalidatePath("/[locale]/categories", "page");
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
