import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { excelCurrencyNumFmt } from "@/i18n/format";
import { EN_EXPORT_COPY } from "@/server/export/copy";
import {
  buildExportWorkbook,
  centsToExcelNumber,
  type ExportMonthSheet,
} from "@/server/export/build-workbook";

describe("export workbook builder (UC-19)", () => {
  it("converts integer cents at the Excel boundary", () => {
    expect(centsToExcelNumber(200_000)).toBe(2000);
    expect(centsToExcelNumber(50_00)).toBe(50);
    expect(centsToExcelNumber(-2_000)).toBe(-20);
    expect(centsToExcelNumber(0)).toBe(0);
  });

  it("writes one sheet per month, newest first, with formulas and no Origin column", async () => {
    const buffer = await buildExportWorkbook({
      copy: EN_EXPORT_COPY,
      months: [septemberEmpty(), augustFilled()],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "September 2026",
      "August 2026",
    ]);

    const august = workbook.getWorksheet("August 2026");
    expect(august).toBeDefined();

    expect(sectionTitles(august!)).toEqual([
      "Summary",
      "Incomes",
      "Actuals",
      "Committed",
      "Estimated",
    ]);
    expect(august!.getCell(4, 1).value).toBe("Summary");
    expect(headerValues(august!)).not.toContain("Origin");
    expect(committedHeaders(august!)).toEqual([
      "Category",
      "Name",
      "Notes",
      "Remaining",
      "Original",
    ]);

    const eurFmt = excelCurrencyNumFmt("EUR");
    expect(formulaOf(august!.getCell(5, 2))).toBe("C14");
    expect(formulaOf(august!.getCell(6, 2))).toBe("D19");
    expect(formulaOf(august!.getCell(7, 2))).toBe("D24+D29");
    expect(formulaOf(august!.getCell(8, 2))).toBe("B6+B7");
    expect(formulaOf(august!.getCell(9, 2))).toBe("B5-B8");
    expect(formulaOf(august!.getCell(14, 3))).toBe("SUM(C13:C13)");
    expect(formulaOf(august!.getCell(19, 4))).toBe("SUM(D18:D18)");
    expect(formulaOf(august!.getCell(24, 4))).toBe("SUM(D23:D23)");
    expect(formulaOf(august!.getCell(29, 4))).toBe("SUM(D28:D28)");

    const summary = summaryAmounts(august!);
    expect(summary["Income"]).toBe(2000);
    expect(summary["Actuals"]).toBe(50);
    expect(summary["Reserved"]).toBe(1200);
    expect(summary["Total Expenses"]).toBe(1250);
    expect(summary["Potential savings"]).toBe(750);

    expect(august!.getCell(5, 2).numFmt).toBe(eurFmt);
    expect(august!.getCell(13, 3).numFmt).toBe(eurFmt);
    expect(august!.getCell(14, 3).numFmt).toBe(eurFmt);
    expect(august!.getCell(18, 4).numFmt).toBe(eurFmt);
    expect(august!.getCell(23, 4).numFmt).toBe(eurFmt);
    expect(august!.getCell(23, 5).numFmt).toBe(eurFmt);
    expect(august!.getCell(24, 4).numFmt).toBe(eurFmt);

    const september = workbook.getWorksheet("September 2026");
    expect(september).toBeDefined();
    expect(formulaOf(september!.getCell(5, 2))).toBe("C13");
    expect(formulaOf(september!.getCell(13, 3))).toBe("SUM(C12:C12)");
    expect(formulaOf(september!.getCell(9, 2))).toBe("B5-B8");
    const emptySummary = summaryAmounts(september!);
    expect(emptySummary["Income"]).toBe(0);
    expect(emptySummary["Potential savings"]).toBe(0);
    expect(september!.getCell(13, 3).numFmt).toBe(eurFmt);
  });

  it("applies the profile currency symbol in Excel number formats", async () => {
    const buffer = await buildExportWorkbook({
      copy: EN_EXPORT_COPY,
      months: [{ ...augustFilled(), sheetName: "August 2026", currency: "USD" }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("August 2026")!;
    const usdFmt = excelCurrencyNumFmt("USD");
    expect(usdFmt).toContain("$");
    expect(sheet.getCell(5, 2).numFmt).toBe(usdFmt);
    expect(sheet.getCell(13, 3).numFmt).toBe(usdFmt);
    expect(sheet.getCell(14, 3).numFmt).toBe(usdFmt);
  });
});

function augustFilled(): ExportMonthSheet {
  return {
    sheetName: "August 2026",
    title: "August 2026",
    currency: "EUR",
    incomes: [{ categoryName: "Salary", name: "Pay", amountCents: 200_000 }],
    actuals: [
      {
        categoryName: "Food",
        name: "Lidl",
        notes: "Milk",
        amountCents: 5_000,
      },
    ],
    committed: [
      {
        categoryName: "Housing",
        name: "Mortgage",
        notes: "",
        origin: "cloned",
        remainingCents: 80_000,
        originalCents: 80_000,
      },
    ],
    estimated: [
      {
        categoryName: "Food",
        name: "Groceries",
        notes: "",
        origin: "cloned",
        remainingCents: 40_000,
        originalCents: 40_000,
      },
    ],
    summary: {
      incomesTotal: 200_000,
      actualsTotal: 5_000,
      reservedRemainingTotal: 120_000,
      totalExpenses: 125_000,
      potentialSavings: 75_000,
    },
  };
}

function septemberEmpty(): ExportMonthSheet {
  return {
    sheetName: "September 2026",
    title: "September 2026",
    currency: "EUR",
    incomes: [],
    actuals: [],
    committed: [],
    estimated: [],
    summary: {
      incomesTotal: 0,
      actualsTotal: 0,
      reservedRemainingTotal: 0,
      totalExpenses: 0,
      potentialSavings: 0,
    },
  };
}

function numericCell(cell: ExcelJS.Cell): number | undefined {
  const value = cell.value;
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "formula" in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === "number") return result;
    // ExcelJS omits a cached result of 0 from the xlsx XML.
    return 0;
  }
  return undefined;
}

function formulaOf(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value;
  if (value && typeof value === "object" && "formula" in value) {
    const formula = (value as { formula?: unknown }).formula;
    return typeof formula === "string" ? formula : undefined;
  }
  return undefined;
}

function summaryAmounts(sheet: ExcelJS.Worksheet): Record<string, number> {
  const out: Record<string, number> = {};
  for (let row = 5; row <= 9; row++) {
    const label = String(sheet.getCell(row, 1).value ?? "");
    const amount = numericCell(sheet.getCell(row, 2));
    if (label.length > 0 && amount !== undefined) out[label] = amount;
  }
  return out;
}

function sectionTitles(sheet: ExcelJS.Worksheet): string[] {
  const wanted = new Set([
    "Summary",
    "Incomes",
    "Actuals",
    "Committed",
    "Estimated",
  ]);
  const titles: string[] = [];
  sheet.eachRow((row, number) => {
    const label = String(row.getCell(1).value ?? "");
    if (!wanted.has(label)) return;
    const nextLabel = String(sheet.getRow(number + 1).getCell(1).value ?? "");
    const isBlockHeader = label === "Summary" || nextLabel === "Category";
    if (!isBlockHeader) return;
    titles.push(label);
  });
  return titles;
}

function headerValues(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.eachRow((row) => {
    for (let col = 1; col <= 5; col++) {
      const label = String(row.getCell(col).value ?? "");
      if (label.length > 0) headers.push(label);
    }
  });
  return headers;
}

function committedHeaders(sheet: ExcelJS.Worksheet): string[] {
  let committedRow = 0;
  sheet.eachRow((row, number) => {
    if (String(row.getCell(1).value ?? "") === "Committed" && committedRow === 0) {
      committedRow = number;
    }
  });
  const headerRow = sheet.getRow(committedRow + 1);
  return [1, 2, 3, 4, 5].map((col) => String(headerRow.getCell(col).value ?? ""));
}
