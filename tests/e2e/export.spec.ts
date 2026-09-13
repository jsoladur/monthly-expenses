import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import ExcelJS from "exceljs";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-19 Excel export", () => {
  test("All downloads one sheet per owned month, newest first", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc19-all-${Date.now()}@example.com`,
      googleSub: `e2e-uc19-all-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedMonth(DB_URL, user.id, 2026, 9);
    await seedMonth(DB_URL, user.id, 2025, 12);

    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Export expenses")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("monthly-expenses-all.xlsx");
    const workbook = await loadDownload(download);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "September 2026",
      "August 2026",
      "December 2025",
    ]);
  });

  test("Select by year lists years descending and allows multiple years", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc19-year-${Date.now()}@example.com`,
      googleSub: `e2e-uc19-year-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedMonth(DB_URL, user.id, 2025, 12);

    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Select by year/ }).click();
    const yearBoxes = dialog.getByRole("group", { name: "Years" }).getByRole("checkbox");
    await expect(yearBoxes).toHaveText(["2026", "2025"]);
    await expect(dialog.getByRole("button", { name: "Download Excel" })).toBeDisabled();

    await dialog.getByRole("checkbox", { name: "2026" }).click();
    await dialog.getByRole("checkbox", { name: "2025" }).click();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("monthly-expenses-selected.xlsx");
    const workbook = await loadDownload(download);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "August 2026",
      "December 2025",
    ]);
  });

  test("Select specific months lists descending and requires a check", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc19-months-${Date.now()}@example.com`,
      googleSub: `e2e-uc19-months-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedMonth(DB_URL, user.id, 2025, 12);

    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Select specific months/ }).click();
    const monthBoxes = dialog.getByRole("group", { name: "Months" }).getByRole("checkbox");
    await expect(monthBoxes).toHaveText(["August 2026", "December 2025"]);
    await expect(dialog.getByRole("button", { name: "Download Excel" })).toBeDisabled();

    await dialog.getByRole("checkbox", { name: "December 2025" }).click();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("monthly-expenses-2025-12.xlsx");
    const workbook = await loadDownload(download);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "December 2025",
    ]);
  });

  test("zero months keeps Download disabled", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc19-empty-${Date.now()}@example.com`,
      googleSub: `e2e-uc19-empty-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("button", { name: "Export" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Create a month first")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download Excel" })).toBeDisabled();
  });

  test("Spanish shell uses Exportar / Descargar Excel", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc19-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc19-es-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/es`);
    await page.getByRole("button", { name: "Exportar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Exportar gastos")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Descargar Excel" })).toBeVisible();
  });
});

async function attachSessionCookie(
  context: BrowserContext,
  user: { id: string; email: string },
) {
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
}

async function resetMonthState(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM template WHERE user_id = ${userId}`;
    await sql`DELETE FROM category WHERE user_id = ${userId}`;
    await sql`DELETE FROM month WHERE user_id = ${userId}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedMonth(
  dbUrl: string,
  userId: string,
  year: number,
  month: number,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO month (user_id, year, month)
      VALUES (${userId}, ${year}, ${month})
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function loadDownload(download: { path: () => Promise<string | null> }) {
  const path = await download.path();
  if (!path) throw new Error("download path missing");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}
