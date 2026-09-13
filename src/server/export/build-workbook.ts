import "server-only";
import ExcelJS from "exceljs";
import { formatCents, sumCents } from "@/server/money";
import type { ExportCopy } from "@/server/export/copy";

// ============================================================================
// Excel workbook builder (UC-19, ADR-11).
//
// Integer cents until this file. Each cell converts once via
// `Number(formatCents(cents))` (ARCH §8). Totals are precomputed by the
// service — this module never sums amounts and never writes `=SUM()`.
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

const AMOUNT_NUM_FMT = "#,##0.00";

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
  const sheet = workbook.addWorksheet(data.sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
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
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ];

  let row = 1;
  sheet.mergeCells(row, 1, row, 6);
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = `${copy.appName} — ${data.title}`;
  applyHeaderFill(titleCell, NAVY);
  titleCell.font = { ...titleCell.font, size: 14 };
  sheet.getRow(row).height = 22;
  row += 1;

  sheet.getCell(row, 1).value = copy.currency;
  sheet.getCell(row, 1).font = { color: { argb: INK }, bold: true, name: "Calibri" };
  sheet.getCell(row, 2).value = data.currency;
  row += 2;

  row = writeSimpleSection({
    sheet,
    startRow: row,
    title: copy.incomes,
    headerFill: GREEN_DEEP,
    headers: [copy.category, copy.name, copy.amount],
    rows: data.incomes.map((item) => [
      item.categoryName,
      item.name,
      centsToExcelNumber(item.amountCents),
    ]),
    amountCol: 3,
    totalLabel: copy.total,
    totalCents: data.summary.incomesTotal,
    columnCount: 3,
  });
  row += 1;

  row = writeSimpleSection({
    sheet,
    startRow: row,
    title: copy.actuals,
    headerFill: BLUE,
    headers: [copy.category, copy.name, copy.notes, copy.amount],
    rows: data.actuals.map((item) => [
      item.categoryName,
      item.name,
      item.notes,
      centsToExcelNumber(item.amountCents),
    ]),
    amountCol: 4,
    totalLabel: copy.total,
    totalCents: data.summary.actualsTotal,
    columnCount: 4,
  });
  row += 1;

  row = writeReservedSection({
    sheet,
    startRow: row,
    title: copy.committed,
    headerFill: NAVY,
    copy,
    rows: data.committed,
    totalCents: sumRemaining(data.committed),
  });
  row += 1;

  row = writeReservedSection({
    sheet,
    startRow: row,
    title: copy.estimated,
    headerFill: TEAL,
    copy,
    rows: data.estimated,
    totalCents: sumRemaining(data.estimated),
  });
  row += 1;

  writeSummary(sheet, row, copy, data);
}

function sumRemaining(rows: ExportReservedRow[]): number {
  return sumCents(rows.map((row) => row.remainingCents));
}

function writeReservedSection({
  sheet,
  startRow,
  title,
  headerFill,
  copy,
  rows,
  totalCents,
}: {
  sheet: ExcelJS.Worksheet;
  startRow: number;
  title: string;
  headerFill: string;
  copy: ExportCopy;
  rows: ExportReservedRow[];
  totalCents: number;
}): number {
  return writeSimpleSection({
    sheet,
    startRow,
    title,
    headerFill,
    headers: [
      copy.category,
      copy.name,
      copy.notes,
      copy.origin,
      copy.remaining,
      copy.original,
    ],
    rows: rows.map((item) => [
      item.categoryName,
      item.name,
      item.notes,
      item.origin === "cloned" ? copy.originCloned : copy.originMonthOnly,
      centsToExcelNumber(item.remainingCents),
      centsToExcelNumber(item.originalCents),
    ]),
    amountCol: 5,
    totalLabel: copy.total,
    totalCents,
    columnCount: 6,
  });
}

function writeSimpleSection({
  sheet,
  startRow,
  title,
  headerFill,
  headers,
  rows,
  amountCol,
  totalLabel,
  totalCents,
  columnCount,
}: {
  sheet: ExcelJS.Worksheet;
  startRow: number;
  title: string;
  headerFill: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  amountCol: number;
  totalLabel: string;
  totalCents: number;
  columnCount: number;
}): number {
  let row = startRow;
  sheet.mergeCells(row, 1, row, columnCount);
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = title;
  applyHeaderFill(titleCell, headerFill);
  row += 1;

  for (let i = 0; i < headers.length; i++) {
    const cell = sheet.getCell(row, i + 1);
    cell.value = headers[i];
    cell.font = { bold: true, color: { argb: INK }, name: "Calibri" };
    cell.fill = solid(OFFWHITE);
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER } },
    };
  }
  row += 1;

  for (const values of rows) {
    for (let i = 0; i < values.length; i++) {
      const cell = sheet.getCell(row, i + 1);
      cell.value = values[i];
      cell.font = { color: { argb: INK }, name: "Calibri" };
      if (typeof values[i] === "number") {
        cell.numFmt = AMOUNT_NUM_FMT;
        cell.alignment = { horizontal: "right" };
      }
    }
    row += 1;
  }

  const totalRow = sheet.getRow(row);
  const totalLabelCell = sheet.getCell(row, 1);
  totalLabelCell.value = totalLabel;
  const totalValueCell = sheet.getCell(row, amountCol);
  totalValueCell.value = centsToExcelNumber(totalCents);
  totalValueCell.numFmt = AMOUNT_NUM_FMT;
  totalValueCell.alignment = { horizontal: "right" };
  for (let col = 1; col <= columnCount; col++) {
    const cell = sheet.getCell(row, col);
    cell.font = { bold: true, color: { argb: INK }, name: "Calibri" };
    cell.fill = solid(OFFWHITE);
    cell.border = {
      top: { style: "thin", color: { argb: BORDER } },
    };
  }
  totalRow.commit();
  return row + 1;
}

function writeSummary(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  copy: ExportCopy,
  data: ExportMonthSheet,
): void {
  let row = startRow;
  sheet.mergeCells(row, 1, row, 2);
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = copy.summary;
  applyHeaderFill(titleCell, NAVY);
  row += 1;

  const lines: Array<{ label: string; cents: number; savings?: boolean }> = [
    { label: copy.income, cents: data.summary.incomesTotal },
    { label: copy.actuals, cents: data.summary.actualsTotal },
    { label: copy.reserved, cents: data.summary.reservedRemainingTotal },
    { label: copy.totalExpenses, cents: data.summary.totalExpenses },
    { label: copy.savings, cents: data.summary.potentialSavings, savings: true },
  ];

  for (const line of lines) {
    const labelCell = sheet.getCell(row, 1);
    const valueCell = sheet.getCell(row, 2);
    labelCell.value = line.label;
    valueCell.value = centsToExcelNumber(line.cents);
    valueCell.numFmt = AMOUNT_NUM_FMT;
    valueCell.alignment = { horizontal: "right" };
    labelCell.font = {
      bold: true,
      color: { argb: line.savings ? GREEN_DEEP : INK },
      name: "Calibri",
    };
    valueCell.font = {
      bold: true,
      color: { argb: line.savings ? GREEN_DEEP : INK },
      name: "Calibri",
    };
    if (line.savings) {
      labelCell.fill = solid(GREEN_TINT);
      valueCell.fill = solid(GREEN_TINT);
    }
    row += 1;
  }
}

function applyHeaderFill(cell: ExcelJS.Cell, argb: string): void {
  cell.fill = solid(argb);
  cell.font = { bold: true, color: { argb: WHITE }, name: "Calibri", size: 12 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function solid(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
