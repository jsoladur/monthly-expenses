"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  ActualNotFoundOnUndoError,
  MonthLineNotFoundError,
  NotUndoableError,
  UndoForbiddenAfterEditError,
  passToActual as servicePass,
  undoPassToActual as serviceUndo,
} from "@/server/services/pass-to-actual";

// ============================================================================
// Pass-to-actual server actions (UC-10, ADR-6).
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
// Both actions are intentionally thin — pass-to-actual and undo are owned
// by the service so the wire schema + tenancy check stay declarative here.
// ============================================================================

const passSchema = z.object({
  lineId: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

const undoSchema = z.object({
  actualId: uuidSchema,
  monthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

// Stable error codes — the client maps these to i18n keys.
export type PassToActualActionError =
  | "monthLineNotFound"
  | "actualNotFound"
  | "notUndoable"
  | "undoForbiddenAfterEdit"
  | "validation";

export type PassToActualActionResult =
  | { ok: true }
  | { ok: false; error: PassToActualActionError };

export async function passToActualAction(input: {
  lineId: string;
  monthId: string;
  year: number;
  month: number;
}): Promise<PassToActualActionResult> {
  const parsed = passSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await servicePass(userId, { lineId: parsed.data.lineId });
  } catch (err) {
    if (err instanceof MonthLineNotFoundError) {
      return { ok: false, error: "monthLineNotFound" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  return { ok: true };
}

export async function undoPassToActualAction(input: {
  actualId: string;
  monthId: string;
  year: number;
  month: number;
}): Promise<PassToActualActionResult> {
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await serviceUndo(userId, { actualId: parsed.data.actualId });
  } catch (err) {
    if (err instanceof UndoForbiddenAfterEditError) {
      return { ok: false, error: "undoForbiddenAfterEdit" };
    }
    if (err instanceof NotUndoableError) {
      return { ok: false, error: "notUndoable" };
    }
    if (err instanceof ActualNotFoundOnUndoError) {
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