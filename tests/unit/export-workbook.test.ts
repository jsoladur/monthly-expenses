import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
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

  it("writes one sheet per month, newest first, with section totals and no charts", async () => {
    const buffer = await buildExportWorkbook({
      copy: EN_EXPORT_COPY,
      months: [septemberEmpty(), augustFilled()],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-09 September",
      "2026-08 August",
    ]);

    const august = workbook.getWorksheet("2026-08 August");
    expect(august).toBeDefined();
    const summary = summaryAmounts(august!);
    expect(summary["Income"]).toBe(2000);
    expect(summary["Actuals"]).toBe(50);
    expect(summary["Reserved"]).toBe(1200);
    expect(summary["Total Expenses"]).toBe(1250);
    expect(summary["Potential savings"]).toBe(750);

    const september = workbook.getWorksheet("2026-09 September");
    expect(september).toBeDefined();
    const emptySummary = summaryAmounts(september!);
    expect(emptySummary["Income"]).toBe(0);
    expect(emptySummary["Potential savings"]).toBe(0);

    expect(sectionTitles(august!)).toEqual([
      "Incomes",
      "Actuals",
      "Committed",
      "Estimated",
      "Summary",
    ]);
  });
});

function augustFilled(): ExportMonthSheet {
  return {
    sheetName: "2026-08 August",
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
    sheetName: "2026-09 September",
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

function summaryAmounts(sheet: ExcelJS.Worksheet): Record<string, number> {
  const out: Record<string, number> = {};
  let inSummary = false;
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "");
    if (label === "Summary") {
      inSummary = true;
      return;
    }
    if (inSummary && label.length > 0) {
      const value = row.getCell(2).value;
      if (typeof value === "number") out[label] = value;
    }
  });
  return out;
}

function sectionTitles(sheet: ExcelJS.Worksheet): string[] {
  const titles: string[] = [];
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "");
    if (
      label === "Incomes" ||
      label === "Actuals" ||
      label === "Committed" ||
      label === "Estimated" ||
      label === "Summary"
    ) {
      if (label === "Actuals" && titles.includes("Actuals")) return;
      titles.push(label);
    }
  });
  return titles;
}
