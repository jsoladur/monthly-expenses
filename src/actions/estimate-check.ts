"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { monthSchema, uuidSchema, yearSchema } from "@/server/validators";
import { requireUserId } from "@/server/auth/require-user-id";
import { MonthNotFoundError } from "@/server/services/months";
import {
  applyEstimateSuggestion as serviceApply,
  EstimateCategoryNotFoundError,
} from "@/server/services/estimate-check";

// ============================================================================
// Estimate-check server action (UC-25, ADR-6).
//
// Thin: Zod parse → `requireUserId()` → service → revalidate. The client only
// names the month, category and mode; every amount is recomputed server-side
// inside the service transaction.
// ============================================================================

const applySchema = z.object({
  monthId: uuidSchema,
  categoryId: uuidSchema,
  year: yearSchema,
  month: monthSchema,
  mode: z.enum(["suggested", "release"]),
});

export type EstimateCheckActionError = "monthNotFound" | "categoryNotFound" | "validation";

export type EstimateCheckActionResult =
  | { ok: true }
  | { ok: false; error: EstimateCheckActionError };

export async function applyEstimateSuggestionAction(input: {
  monthId: string;
  categoryId: string;
  year: number;
  month: number;
  mode: "suggested" | "release";
}): Promise<EstimateCheckActionResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  try {
    await serviceApply(userId, {
      monthId: parsed.data.monthId,
      categoryId: parsed.data.categoryId,
      mode: parsed.data.mode,
    });
  } catch (err) {
    if (err instanceof MonthNotFoundError) {
      return { ok: false, error: "monthNotFound" };
    }
    if (err instanceof EstimateCategoryNotFoundError) {
      return { ok: false, error: "categoryNotFound" };
    }
    throw err;
  }
  revalidatePath("/[locale]/months/[year]/[month]", "page");
  revalidatePath(`/${locale}/months/${parsed.data.year}/${parsed.data.month}`, "page");
  return { ok: true };
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : "en";
}
