"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currencySchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  InvalidCurrencyError,
  ProfileSettingsNotFoundError,
  getProfileSettings as serviceGet,
  updateCurrency as serviceUpdate,
} from "@/server/services/settings";

// ============================================================================
// Settings server actions (UC-04, ADR-6).
//
// One action per mutation: `updateCurrencyAction`. Follows the same pattern
// as `src/actions/categories.ts` (ARCH §5 rule 3):
//   1. Zod-parse the input. Failure → `{ ok: false, error: "validation" }`.
//   2. Resolve the tenant via `requireUserId()` (PRD §5.1, ARCH §3.2 rule 4).
//      Locale is read from `x-next-intl-locale` so unauthenticated callers
//      land on the locale-prefixed sign-in URL.
//   3. Call the service. Domain errors translate to stable i18n keys in
//      the action result so the client component renders localized copy
//      (PRD §11).
//   4. `revalidatePath` invalidates the settings page AND the root
//      (`/[locale]`) so any cached amounts that read the currency label
//      (UC-06+, UC-11) refresh on next render.
//
// `getProfileSettingsAction` is NOT a server action — reads happen in the
// RSC (`page.tsx`) where they can share `React.cache` with `requireUserId`.
// The export here is just the read helper so future call sites can import
// the service path uniformly.
// ============================================================================

const updateSchema = z.object({ currency: currencySchema });

export type SettingsActionError = "validation" | "currencyInvalid" | "notFound";

export type SettingsActionResult =
  | { ok: true }
  | { ok: false; error: SettingsActionError };

export async function updateCurrencyAction(input: {
  currency: string;
}): Promise<SettingsActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const userId = await requireUserId(await getLocaleFromHeaders());
  try {
    await serviceUpdate(userId, parsed.data.currency);
  } catch (err) {
    if (err instanceof InvalidCurrencyError) {
      return { ok: false, error: "currencyInvalid" };
    }
    if (err instanceof ProfileSettingsNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    throw err;
  }
  // Invalidate BOTH the settings page and any other surface that may have
  // cached the old currency label (UC-06 month workspace, UC-11 summary).
  revalidatePath("/[locale]/settings", "page");
  revalidatePath("/[locale]", "page");
  return { ok: true };
}

// `getProfileSettingsAction` is the RSC read shape — re-exported from the
// service module so callers that need the full service path have one import.
// The settings page calls the service directly (not via this file) because
// page.tsx is a server component and `requireUserId()` is cached there.
export { serviceGet as getProfileSettings };

// The edge middleware sets `x-next-intl-locale` on every request it
// processes. If the header is missing (action invoked from a non-locale
// context), fall back to the default so `requireUserId()` still produces a
// valid sign-in redirect.
async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
