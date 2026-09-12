"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  CommittedLineCannotPassToUpcomingError,
  MonthLineNotFoundError,
  NotCurrentYearError,
  TargetMonthNotFoundError,
  TargetNotUpcomingError,
  passToUpcomingMonth as servicePass,
} from "@/server/services/pass-to-upcoming";

// ============================================================================
// Pass-to-upcoming-month server action (UC-18, ADR-6).
//
// Thin: Zod parse → requireUserId → service → revalidate source AND target
// workspace pages so both Estimated tabs refresh.
// ============================================================================

const passSchema = z.object({
  lineId: uuidSchema,
  targetMonthId: uuidSchema,
  year: z.number().int().min(1970).max(9999),
  month: z.number().int().min(1).max(12),
});

export type PassToUpcomingActionError =
  | "monthLineNotFound"
  | "committedLineCannotPassToUpcoming"
  | "notCurrentYear"
  | "targetMonthNotFound"
  | "targetNotUpcoming"
  | "validation";

export type PassToUpcomingActionResult =
  | { ok: true }
  | { ok: false; error: PassToUpcomingActionError };

export async function passToUpcomingMonthAction(input: {
  lineId: string;
  targetMonthId: string;
  year: number;
  month: number;
}): Promise<PassToUpcomingActionResult> {
  const parsed = passSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  let result;
  try {
    result = await servicePass(userId, {
      lineId: parsed.data.lineId,
      targetMonthId: parsed.data.targetMonthId,
    });
  } catch (err) {
    if (err instanceof MonthLineNotFoundError) {
      return { ok: false, error: "monthLineNotFound" };
    }
    if (err instanceof CommittedLineCannotPassToUpcomingError) {
      return { ok: false, error: "committedLineCannotPassToUpcoming" };
    }
    if (err instanceof NotCurrentYearError) {
      return { ok: false, error: "notCurrentYear" };
    }
    if (err instanceof TargetMonthNotFoundError) {
      return { ok: false, error: "targetMonthNotFound" };
    }
    if (err instanceof TargetNotUpcomingError) {
      return { ok: false, error: "targetNotUpcoming" };
    }
    throw err;
  }
  revalidateMonthWorkspace(locale, parsed.data.year, parsed.data.month);
  revalidateMonthWorkspace(locale, result.targetYear, result.targetMonth);
  return { ok: true };
}

function revalidateMonthWorkspace(
  locale: string,
  year: number,
  month: number,
): void {
  revalidatePath(`/[locale]/months/${year}/${month}`, "page");
  revalidatePath(`/${locale}/months/${year}/${month}`, "page");
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
