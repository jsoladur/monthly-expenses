"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { requireUserId } from "@/server/auth/require-user-id";
import { monthSchema, yearSchema } from "@/server/validators";
import {
  NothingToExportError,
  exportExpenses as serviceExport,
} from "@/server/services/export";
import { isAppLocale } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import type { ExportCopy } from "@/server/export/copy";
import type { ExportSelection } from "@/lib/export-selection";

// ============================================================================
// Excel export server action (UC-19, ADR-6).
//
// Read-shaped: Zod → requireUserId → service → { filename, base64 }.
// No revalidate. The client turns the payload into a browser download.
// ============================================================================

const periodSchema = z.object({
  year: yearSchema,
  month: monthSchema,
});

const exportSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("year"),
    years: z.array(yearSchema).min(1).max(50),
  }),
  z.object({
    mode: z.literal("months"),
    periods: z.array(periodSchema).min(1).max(240),
  }),
]);

export type ExportActionError = "nothingToExport" | "validation";

export type ExportActionResult =
  | { ok: true; filename: string; base64: string }
  | { ok: false; error: ExportActionError };

export async function exportExpensesAction(
  input: unknown,
): Promise<ExportActionResult> {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }
  const locale = await getLocaleFromHeaders();
  const userId = await requireUserId(locale);
  const copy = await loadExportCopy(locale);

  let result;
  try {
    result = await serviceExport(userId, parsed.data as ExportSelection, {
      locale: isAppLocale(locale) ? locale : routing.defaultLocale,
      copy,
    });
  } catch (err) {
    if (err instanceof NothingToExportError) {
      return { ok: false, error: "nothingToExport" };
    }
    throw err;
  }

  return {
    ok: true,
    filename: result.filename,
    base64: result.buffer.toString("base64"),
  };
}

async function loadExportCopy(locale: string): Promise<ExportCopy> {
  const t = await getTranslations({ locale, namespace: "export.sheet" });
  const ts = await getTranslations({ locale, namespace: "months.summary" });
  const ta = await getTranslations({ locale, namespace: "app" });
  return {
    appName: ta("name"),
    currency: t("currency"),
    incomes: t("incomes"),
    actuals: t("actuals"),
    committed: t("committed"),
    estimated: t("estimated"),
    summary: t("summary"),
    category: t("category"),
    name: t("name"),
    notes: t("notes"),
    amount: t("amount"),
    remaining: t("remaining"),
    original: t("original"),
    origin: t("origin"),
    total: t("total"),
    income: ts("income"),
    reserved: ts("reserved"),
    totalExpenses: ts("totalExpenses"),
    savings: ts("savings"),
    originCloned: t("originCloned"),
    originMonthOnly: t("originMonthOnly"),
  };
}

async function getLocaleFromHeaders(): Promise<string> {
  const headerList = await headers();
  const locale = headerList.get("x-next-intl-locale");
  return locale && locale.length > 0 ? locale : routing.defaultLocale;
}
