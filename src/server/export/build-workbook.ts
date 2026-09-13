import "server-only";
import ExcelJS from "exceljs";
import { formatCents } from "@/server/money";
import { excelCurrencyNumFmt } from "@/i18n/format";
import type { ExportCopy } from "@/server/export/copy";

// ============================================================================
// Excel workbook builder (UC-19, ADR-11).
//
// Line amounts convert once via `Number(formatCents(cents))` (ARCH §8).
// Section totals and the Summary block are Excel formulas so the workbook
// recalculates when a cell is edited. Cached `result` is the integer-cents
// value for viewers that do not recalc on open.
// ============================================================================

const NAVY = "FF1B3A6B";
const BLUE = "FF2E7DB2";
const GREEN_DEEP = "FF4C7A1F";
const TEAL = "FF2AA198";
const INK = "FF0F1E33";
const WHITE = "FFFFFFFF";
const OFFWHITE = "FFF6F8FB";
const GREEN_TINT = "FFEFF7E3";
const BORDER = "FFE2E8F0";

const SUMMARY_VALUE_COL = 2;
const INCOMES_AMOUNT_COL = 3;
const ACTUALS_AMOUNT_COL = 4;
const RESERVED_REMAINING_COL = 4;
const RESERVED_ORIGINAL_COL = 5;

export type ExportIncomeRow = {
  categoryName: string;
  name: string;
  amountCents: number;
};

export type ExportActualRow = {
  categoryName: string;
  name: string;
  notes: string;
  amountCents: number;
};

export type ExportReservedRow = {
  categoryName: string;
  name: string;
  notes: string;
  origin: "cloned" | "month_only";
  remainingCents: number;
  originalCents: number;
};

export type ExportMonthSheet = {
  sheetName: string;
  title: string;
  currency: string;
  incomes: ExportIncomeRow[];
  actuals: ExportActualRow[];
  committed: ExportReservedRow[];
  estimated: ExportReservedRow[];
  summary: {
    incomesTotal: number;
    actualsTotal: number;
    reservedRemainingTotal: number;
    totalExpenses: number;
    potentialSavings: number;
  };
};

export type ExportWorkbookInput = {
  copy: ExportCopy;
  months: ExportMonthSheet[];
};

type SectionPlan = {
  titleRow: number;
  headerRow: number;
  firstDataRow: number;
  totalRow: number;
  dataCount: number;
};

export function centsToExcelNumber(cents: number): number {
  return Number(formatCents(cents));
}

export async function buildExportWorkbook(
  input: ExportWorkbookInput,
): Promise<Buffer> {
  if (input.months.length === 0) {
    throw new RangeError("buildExportWorkbook requires at least one month");
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.copy.appName;
  workbook.created = new Date();

  for (const monthSheet of input.months) {
    writeMonthSheet(workbook, input.copy, monthSheet);
  }

  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}

function writeMonthSheet(
  workbook: ExcelJS.Workbook,
  copy: ExportCopy,
  data: ExportMonthSheet,
): void {
  const currencyFmt = excelCurrencyNumFmt(data.currency);
  const sheet = workbook.addWorksheet(data.sheetName, {
    views: [{ state: "frozen", ySplit: 9 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });

  sheet.columns = [
    { width: 22 },
    { width: 28 },
    { width: 32 },
    { width: 16 },
    { width: 16 },
  ];

  sheet.mergeCells(1, 1, 1, 5);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${copy.appName} — ${data.title}`;
  applyHeaderFill(titleCell, NAVY);
  titleCell.font = { ...titleCell.font, size: 14 };
  sheet.getRow(1).height = 22;

  sheet.getCell(2, 1).value = copy.currency;
  sheet.getCell(2, 1).font = { color: { argb: INK }, bold: true, name: "Calibri" };
  sheet.getCell(2, 2).value = data.currency;

  const summaryTitleRow = 4;
  const incomeRow = 5;
  const actualsRow = 6;
  const reservedRow = 7;
  const totalExpRow = 8;
  const savingsRow = 9;

  const incomesPlan = planSection(11, data.incomes.length);
  const actualsPlan = planSection(incomesPlan.totalRow + 2, data.actuals.length);
  const committedPlan = planSection(actualsPlan.totalRow + 2, data.committed.length);
  const estimatedPlan = planSection(committedPlan.totalRow + 2, data.estimated.length);

  const incomesTotalRef = cellRef(INCOMES_AMOUNT_COL, incomesPlan.totalRow);
  const actualsTotalRef = cellRef(ACTUALS_AMOUNT_COL, actualsPlan.totalRow);
  const committedTotalRef = cellRef(RESERVED_REMAINING_COL, committedPlan.totalRow);
  const estimatedTotalRef = cellRef(RESERVED_REMAINING_COL, estimatedPlan.totalRow);
  const summaryIncomeRef = cellRef(SUMMARY_VALUE_COL, incomeRow);
  const summaryActualsRef = cellRef(SUMMARY_VALUE_COL, actualsRow);
  const summaryReservedRef = cellRef(SUMMARY_VALUE_COL, reservedRow);
  const summaryTotalExpRef = cellRef(SUMMARY_VALUE_COL, totalExpRow);

  writeSummaryHeader(sheet, copy, summaryTitleRow);
  writeSummaryLine(sheet, incomeRow, copy.income, {
    formula: incomesTotalRef,
    result: centsToExcelNumber(data.summary.incomesTotal),
    currencyFmt,
  });
  writeSummaryLine(sheet, actualsRow, copy.actuals, {
    formula: actualsTotalRef,
    result: centsToExcelNumber(data.summary.actualsTotal),
    currencyFmt,
  });
  writeSummaryLine(sheet, reservedRow, copy.reserved, {
    formula: `${committedTotalRef}+${estimatedTotalRef}`,
    result: centsToExcelNumber(data.summary.reservedRemainingTotal),
    currencyFmt,
  });
  writeSummaryLine(sheet, totalExpRow, copy.totalExpenses, {
    formula: `${summaryActualsRef}+${summaryReservedRef}`,
    result: centsToExcelNumber(data.summary.totalExpenses),
    currencyFmt,
  });
  writeSummaryLine(sheet, savingsRow, copy.savings, {
    formula: `${summaryIncomeRef}-${summaryTotalExpRef}`,
    result: centsToExcelNumber(data.summary.potentialSavings),
    currencyFmt,
    savings: true,
  });

  writeSimpleSection({
    sheet,
    plan: incomesPlan,
    title: copy.incomes,
    headerFill: GREEN_DEEP,
    headers: [copy.category, copy.name, copy.amount],
    rows: data.incomes.map((item) => [
      item.categoryName,
      item.name,
      centsToExcelNumber(item.amountCents),
    ]),
    amountCols: [INCOMES_AMOUNT_COL],
    totalAmountCol: INCOMES_AMOUNT_COL,
    totalLabel: copy.total,
    totalResultCents: data.summary.incomesTotal,
    columnCount: 3,
    currencyFmt,
  });

  writeSimpleSection({
    sheet,
    plan: actualsPlan,
    title: copy.actuals,
    headerFill: BLUE,
    headers: [copy.category, copy.name, copy.notes, copy.amount],
    rows: data.actuals.map((item) => [
      item.categoryName,
      item.name,
      item.notes,
      centsToExcelNumber(item.amountCents),
    ]),
    amountCols: [ACTUALS_AMOUNT_COL],
    totalAmountCol: ACTUALS_AMOUNT_COL,
    totalLabel: copy.total,
    totalResultCents: data.summary.actualsTotal,
    columnCount: 4,
    currencyFmt,
  });

  writeSimpleSection({
    sheet,
    plan: committedPlan,
    title: copy.committed,
    headerFill: NAVY,
    headers: [copy.category, copy.name, copy.notes, copy.remaining, copy.original],
    rows: data.committed.map((item) => [
      item.categoryName,
      item.name,
      item.notes,
      centsToExcelNumber(item.remainingCents),
      centsToExcelNumber(item.originalCents),
    ]),
    amountCols: [RESERVED_REMAINING_COL, RESERVED_ORIGINAL_COL],
    totalAmountCol: RESERVED_REMAINING_COL,
    totalLabel: copy.total,
    totalResultCents: sumRemaining(data.committed),
    columnCount: 5,
    currencyFmt,
  });

  writeSimpleSection({
    sheet,
    plan: estimatedPlan,
    title: copy.estimated,
    headerFill: TEAL,
    headers: [copy.category, copy.name, copy.notes, copy.remaining, copy.original],
    rows: data.estimated.map((item) => [
      item.categoryName,
      item.name,
      item.notes,
      centsToExcelNumber(item.remainingCents),
      centsToExcelNumber(item.originalCents),
    ]),
    amountCols: [RESERVED_REMAINING_COL, RESERVED_ORIGINAL_COL],
    totalAmountCol: RESERVED_REMAINING_COL,
    totalLabel: copy.total,
    totalResultCents: sumRemaining(data.estimated),
    columnCount: 5,
    currencyFmt,
  });
}

function sumRemaining(rows: ExportReservedRow[]): number {
  let total = 0;
  for (const row of rows) {
    total += row.remainingCents;
  }
  return total;
}

function planSection(startRow: number, dataCount: number): SectionPlan {
  return {
    titleRow: startRow,
    headerRow: startRow + 1,
    firstDataRow: startRow + 2,
    totalRow: startRow + 2 + dataCount,
    dataCount,
  };
}

function writeSimpleSection({
  sheet,
  plan,
  title,
  headerFill,
  headers,
  rows,
  amountCols,
  totalAmountCol,
  totalLabel,
  totalResultCents,
  columnCount,
  currencyFmt,
}: {
  sheet: ExcelJS.Worksheet;
  plan: SectionPlan;
  title: string;
  headerFill: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  amountCols: number[];
  totalAmountCol: number;
  totalLabel: string;
  totalResultCents: number;
  columnCount: number;
  currencyFmt: string;
}): void {
  sheet.mergeCells(plan.titleRow, 1, plan.titleRow, columnCount);
  const titleCell = sheet.getCell(plan.titleRow, 1);
  titleCell.value = title;
  applyHeaderFill(titleCell, headerFill);

  for (let i = 0; i < headers.length; i++) {
    const cell = sheet.getCell(plan.headerRow, i + 1);
    cell.value = headers[i];
    cell.font = { bold: true, color: { argb: INK }, name: "Calibri" };
    cell.fill = solid(OFFWHITE);
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER } },
    };
  }

  rows.forEach((values, index) => {
    const rowNumber = plan.firstDataRow + index;
    for (let i = 0; i < values.length; i++) {
      const cell = sheet.getCell(rowNumber, i + 1);
      cell.value = values[i];
      cell.font = { color: { argb: INK }, name: "Calibri" };
      if (amountCols.includes(i + 1) && typeof values[i] === "number") {
        cell.numFmt = currencyFmt;
        cell.alignment = { horizontal: "right" };
      }
    }
  });

  const totalLabelCell = sheet.getCell(plan.totalRow, 1);
  totalLabelCell.value = totalLabel;
  const totalValueCell = sheet.getCell(plan.totalRow, totalAmountCol);
  totalValueCell.value = {
    formula: sumFormula(totalAmountCol, plan),
    result: centsToExcelNumber(totalResultCents),
  };
  totalValueCell.numFmt = currencyFmt;
  totalValueCell.alignment = { horizontal: "right" };
  for (let col = 1; col <= columnCount; col++) {
    const cell = sheet.getCell(plan.totalRow, col);
    cell.font = { bold: true, color: { argb: INK }, name: "Calibri" };
    cell.fill = solid(OFFWHITE);
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
    };
  }
}

function sumFormula(col: number, plan: SectionPlan): string {
  const letter = colLetter(col);
  if (plan.dataCount > 0) {
    return `SUM(${letter}${plan.firstDataRow}:${letter}${plan.totalRow - 1})`;
  }
  return `SUM(${letter}${plan.headerRow}:${letter}${plan.headerRow})`;
}

function writeSummaryHeader(
  sheet: ExcelJS.Worksheet,
  copy: ExportCopy,
  row: number,
): void {
  sheet.mergeCells(row, 1, row, 2);
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = copy.summary;
  applyHeaderFill(titleCell, NAVY);
}

function writeSummaryLine(
  sheet: ExcelJS.Worksheet,
  row: number,
  label: string,
  opts: {
    formula: string;
    result: number;
    currencyFmt: string;
    savings?: boolean;
  },
): void {
  const labelCell = sheet.getCell(row, 1);
  const valueCell = sheet.getCell(row, SUMMARY_VALUE_COL);
  labelCell.value = label;
  valueCell.value = { formula: opts.formula, result: opts.result };
  valueCell.numFmt = opts.currencyFmt;
  valueCell.alignment = { horizontal: "right" };
  const color = opts.savings ? GREEN_DEEP : INK;
  labelCell.font = { bold: true, color: { argb: color }, name: "Calibri" };
  valueCell.font = { bold: true, color: { argb: color }, name: "Calibri" };
  if (opts.savings) {
    labelCell.fill = solid(GREEN_TINT);
    valueCell.fill = solid(GREEN_TINT);
  }
}

function cellRef(col: number, row: number): string {
  return `${colLetter(col)}${row}`;
}

function colLetter(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function applyHeaderFill(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = solid(argb);
  cell.font = { bold: true, color: { argb: WHITE }, name: "Calibri", size: 12 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
