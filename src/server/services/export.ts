import "server-only";
import type { Month } from "@/server/db/schema";
import {
  listMonths,
  listMonthsByPeriods,
  listMonthsByYears,
} from "@/server/repositories/month";
import {
  listExportActuals,
  listExportIncomes,
  listExportLines,
} from "@/server/repositories/export";
import { getProfileSettings } from "@/server/services/settings";
import { parseAmount, sumCents } from "@/server/money";
import { monthName, monthYear } from "@/i18n/format";
import type { AppLocale } from "@/i18n/routing";
import type { ExportCopy } from "@/server/export/copy";
import {
  buildExportWorkbook,
  type ExportActualRow,
  type ExportIncomeRow,
  type ExportMonthSheet,
  type ExportReservedRow,
} from "@/server/export/build-workbook";
import {
  dedupePeriods,
  dedupeYearsDescending,
  exportFilename,
  sanitizeSheetName,
  type ExportSelection,
} from "@/lib/export-selection";

// ============================================================================
// Excel export service (UC-19, PRD UC-24 / C22, ARCH §5).
//
// Resolves the requested scope to owned months, loads money rows in bulk,
// builds integer-cents summaries (PRD §7.1), then hands DTOs to ExcelJS.
// Never inserts a month (C6). Never returns another tenant's rows (P0).
// ============================================================================

export class NothingToExportError extends Error {
  readonly code = "nothing_to_export" as const;
  constructor() {
    super("Nothing to export for that selection");
    this.name = "NothingToExportError";
  }
}

export async function exportExpenses(
  userId: string,
  selection: ExportSelection,
  opts: { locale: AppLocale; copy: ExportCopy },
): Promise<{ filename: string; buffer: Buffer }> {
  const months = await resolveExportMonths(userId, selection);
  if (months.length === 0) {
    throw new NothingToExportError();
  }

  const settings = await getProfileSettings(userId);
  const currency = settings?.currency ?? "EUR";
  const monthIds = months.map((row) => row.id);

  const [incomes, actuals, lines] = await Promise.all([
    listExportIncomes(userId, monthIds),
    listExportActuals(userId, monthIds),
    listExportLines(userId, monthIds),
  ]);

  const sheets: ExportMonthSheet[] = months.map((row) => {
    const monthIncomes = incomes
      .filter((item) => item.monthId === row.id)
      .map(
        (item): ExportIncomeRow => ({
          categoryName: item.categoryName,
          name: item.name,
          amountCents: parseAmount(item.amount),
        }),
      );
    const monthActuals = actuals
      .filter((item) => item.monthId === row.id)
      .map(
        (item): ExportActualRow => ({
          categoryName: item.categoryName,
          name: item.name,
          notes: item.observations ?? "",
          amountCents: parseAmount(item.amount),
        }),
      );
    const monthLines = lines.filter((item) => item.monthId === row.id);
    const committed = orderReserved(
      monthLines
        .filter((item) => item.kind === "committed")
        .map(toReservedRow),
    );
    const estimated = orderReserved(
      monthLines
        .filter((item) => item.kind === "estimated")
        .map(toReservedRow),
    );

    const incomesTotal = sumCents(monthIncomes.map((item) => item.amountCents));
    const actualsTotal = sumCents(monthActuals.map((item) => item.amountCents));
    const reservedRemainingTotal = sumCents([
      ...committed.map((item) => item.remainingCents),
      ...estimated.map((item) => item.remainingCents),
    ]);
    const totalExpenses = sumCents([actualsTotal, reservedRemainingTotal]);
    const potentialSavings = sumCents([incomesTotal, -totalExpenses]);

    const localeMonth = monthName(opts.locale, row.month);
    return {
      sheetName: sanitizeSheetName(row.year, localeMonth),
      title: monthYear(opts.locale, row.year, row.month),
      currency,
      incomes: monthIncomes,
      actuals: monthActuals,
      committed,
      estimated,
      summary: {
        incomesTotal,
        actualsTotal,
        reservedRemainingTotal,
        totalExpenses,
        potentialSavings,
      },
    };
  });

  const buffer = await buildExportWorkbook({ copy: opts.copy, months: sheets });
  return { filename: exportFilename(selection), buffer };
}

export async function resolveExportMonths(
  userId: string,
  selection: ExportSelection,
): Promise<Month[]> {
  if (selection.mode === "all") {
    return listMonths(userId);
  }
  if (selection.mode === "year") {
    const years = dedupeYearsDescending(selection.years);
    if (years.length === 0) return [];
    return listMonthsByYears(userId, years);
  }
  const periods = dedupePeriods(selection.periods);
  if (periods.length === 0) return [];
  return listMonthsByPeriods(userId, periods);
}

function toReservedRow(item: {
  categoryName: string;
  name: string;
  observations: string | null;
  remainingAmount: string;
  originalAmount: string;
  origin: "cloned" | "month_only";
}): ExportReservedRow {
  return {
    categoryName: item.categoryName,
    name: item.name,
    notes: item.observations ?? "",
    origin: item.origin,
    remainingCents: parseAmount(item.remainingAmount),
    originalCents: parseAmount(item.originalAmount),
  };
}

function orderReserved(rows: ExportReservedRow[]): ExportReservedRow[] {
  return [...rows].sort((a, b) => {
    if (a.origin !== b.origin) {
      return a.origin === "cloned" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

