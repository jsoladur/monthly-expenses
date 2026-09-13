import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "@/server/db/client";
import { createCategory, deactivateCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addIncome } from "@/server/services/incomes";
import { addActual } from "@/server/services/actuals";
import {
  NothingToExportError,
  exportExpenses,
  resolveExportMonths,
} from "@/server/services/export";
import { EN_EXPORT_COPY } from "@/server/export/copy";
import { uniqueYearsDescending } from "@/lib/export-selection";

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-19 Excel export", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("exports all owned months newest first and keeps tenants isolated (#32)", async () => {
    const alice = await seedUser("google-sub-uc19-all-a");
    const bob = await seedUser("google-sub-uc19-all-b");
    const { august } = await seedAliceLedger(alice);
    await createMonth(alice, { year: 2026, month: 9 });
    await createMonth(bob, { year: 2026, month: 10 });

    const result = await exportExpenses(
      alice,
      { mode: "all" },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    expect(result.filename).toBe("monthly-expenses-all.xlsx");

    const workbook = await loadWorkbook(result.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-09 September",
      "2026-08 August",
    ]);

    const augustSheet = workbook.getWorksheet("2026-08 August");
    expect(augustSheet).toBeDefined();
    const summary = summaryAmounts(augustSheet!);
    expect(summary["Income"]).toBe(2000);
    expect(summary["Actuals"]).toBe(50);
    expect(summary["Reserved"]).toBe(1200);
    expect(summary["Total Expenses"]).toBe(1250);
    expect(summary["Potential savings"]).toBe(750);

    const bobExport = await exportExpenses(
      bob,
      { mode: "all" },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    const bobBook = await loadWorkbook(bobExport.buffer);
    expect(bobBook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-10 October",
    ]);

    expect(august.id).toBeTruthy();
  });

  it("exports checked years (one or many) and lists years descending (#33)", async () => {
    const alice = await seedUser("google-sub-uc19-year");
    await seedAliceLedger(alice);
    await createMonth(alice, { year: 2025, month: 12 });

    const owned = await resolveExportMonths(alice, { mode: "all" });
    expect(
      uniqueYearsDescending(owned.map((row) => ({ year: row.year, month: row.month }))),
    ).toEqual([2026, 2025]);

    const result = await exportExpenses(
      alice,
      { mode: "year", years: [2026] },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    expect(result.filename).toBe("monthly-expenses-2026.xlsx");
    const workbook = await loadWorkbook(result.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-08 August",
    ]);

    const both = await exportExpenses(
      alice,
      { mode: "year", years: [2025, 2026] },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    expect(both.filename).toBe("monthly-expenses-selected.xlsx");
    const bothBook = await loadWorkbook(both.buffer);
    expect(bothBook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-08 August",
      "2025-12 December",
    ]);

    await expect(
      exportExpenses(
        alice,
        { mode: "year", years: [2024] },
        { locale: "en", copy: EN_EXPORT_COPY },
      ),
    ).rejects.toBeInstanceOf(NothingToExportError);
  });

  it("exports checked months only, skips other tenants, never auto-creates (#34)", async () => {
    const alice = await seedUser("google-sub-uc19-months-a");
    const bob = await seedUser("google-sub-uc19-months-b");
    await seedAliceLedger(alice);
    await createMonth(alice, { year: 2025, month: 12 });
    await createMonth(bob, { year: 2026, month: 10 });

    const beforeCount = await countMonths(alice);

    const result = await exportExpenses(
      alice,
      {
        mode: "months",
        periods: [
          { year: 2025, month: 12 },
          { year: 2026, month: 8 },
          { year: 2026, month: 10 },
        ],
      },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    expect(result.filename).toBe("monthly-expenses-selected.xlsx");
    const workbook = await loadWorkbook(result.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "2026-08 August",
      "2025-12 December",
    ]);

    expect(await countMonths(alice)).toBe(beforeCount);
    expect(await countMonths(bob)).toBe(1);
  });

  it("still labels a ticket after its category is deactivated", async () => {
    const alice = await seedUser("google-sub-uc19-inactive");
    const { food } = await seedAliceLedger(alice);
    await deactivateCategory(alice, { id: food.id });

    const result = await exportExpenses(
      alice,
      { mode: "year", years: [2026] },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    const workbook = await loadWorkbook(result.buffer);
    const sheet = workbook.getWorksheet("2026-08 August");
    const labels: string[] = [];
    sheet?.eachRow((row) => {
      labels.push(String(row.getCell(1).value ?? ""));
    });
    expect(labels).toContain("Food");
  });

  it("treats a negative actual as first-class in savings", async () => {
    const alice = await seedUser("google-sub-uc19-neg");
    const { august, food } = await seedAliceLedger(alice);
    await addActual(alice, {
      monthId: august.id,
      categoryId: food.id,
      name: "Refund",
      amount: "-20.00",
    });

    const result = await exportExpenses(
      alice,
      { mode: "year", years: [2026] },
      { locale: "en", copy: EN_EXPORT_COPY },
    );
    const workbook = await loadWorkbook(result.buffer);
    const summary = summaryAmounts(workbook.getWorksheet("2026-08 August")!);
    expect(summary["Actuals"]).toBe(30);
    expect(summary["Potential savings"]).toBe(770);
  });
});

async function seedAliceLedger(userId: string) {
  const salary = await createCategory(userId, { kind: "income", name: "Salary" });
  const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
  const food = await createCategory(userId, { kind: "expense", name: "Food" });
  await createTemplate(userId, {
    categoryId: housing.id,
    name: "Mortgage",
    amount: "800.00",
    kind: "committed",
  });
  await createTemplate(userId, {
    categoryId: food.id,
    name: "Groceries",
    amount: "400.00",
    kind: "estimated",
  });
  const august = await createMonth(userId, { year: 2026, month: 8 });
  await addIncome(userId, {
    monthId: august.id,
    categoryId: salary.id,
    name: "Pay",
    amount: "2000.00",
  });
  await addActual(userId, {
    monthId: august.id,
    categoryId: food.id,
    name: "Lidl",
    amount: "50.00",
  });
  return { august, food };
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
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

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) throw new Error("seedUser returned no id");
  return id;
}

async function countMonths(userId: string): Promise<number> {
  const rows = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::text AS n FROM month WHERE user_id = ${userId}`,
  );
  return Number.parseInt(rows[0]!.n, 10);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-19 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
