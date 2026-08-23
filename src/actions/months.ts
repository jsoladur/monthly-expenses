"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { monthSchema, yearSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  DuplicateMonthError,
  createMonth as serviceCreateMonth,
} from "@/server/services/months";
import { setLastOpenedMonthCookie } from "@/server/cookies/last-opened-month";

// ============================================================================
// Months server actions (UC-06, ADR-6).
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
//   4. On success, sets the `last_opened_month` cookie (PRD UC-14, §5.4) so
//      re-opening the home resumes the just-created month, and revalidates
//      the home page so the new month surfaces in the list immediately.
//
// `last_opened_month` is a UX convenience — the canonical tenancy check
// remains `requireUserId()` (PRD §5.1, ARCH §3.2 rule 4). The cookie is
// re-validated against the DB on home load (in `src/app/[locale]/page.tsx`)
// before redirecting.
// ============================================================================

const createSchema = z.object({
  year: yearSchema,
  month: monthSchema,
});

export type MonthActionError = "duplicate" | "validation";

export type CreateMonthResult =
  | { ok: true; year: number; month: number }
  | { ok: false; error: MonthActionError };

export async function createMonthAction(input: {
  year: number;
  month: number;
}): Promise<CreateMonthResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    const created = await serviceCreateMonth(userId, {
      year: parsed.data.year,
      month: parsed.data.month,
    });
    await setLastOpenedMonthCookie(created.year, created.month);
  } catch (err) {
    if (err instanceof DuplicateMonthError) {
      return { ok: false, error: "duplicate" };
    }
    throw err;
  }
  revalidatePath("/[locale]", "page");
  return { ok: true, year: parsed.data.year, month: parsed.data.month };
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
