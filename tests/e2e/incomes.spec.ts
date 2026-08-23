import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-07 month incomes — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03/04/05/06 — seed an `app_user` row +
// forge an Auth.js session cookie via `next-auth/jwt#encode`. The app
// decodes the cookie the same way it decodes one produced by a real Google
// sign-in.
//
// Acceptance criteria covered:
//   - Add an income → row appears with name + amount in EUR (ADR-5, §7.6).
//   - Edit the income → amount + name update; the row reflects the change.
//   - Delete (with confirm) → row disappears; DB row is gone (PRD C15 / §13).
//   - Adding an income with no active income category shows the
//     `validation.noActiveIncomeCategories` empty state (PRD §6.5).
//   - Spanish variant: every label renders in translated copy.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-07 month incomes", () => {
  test("add → edit → delete (UC-07 acceptance)", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc07-${Date.now()}@example.com`,
      googleSub: `e2e-uc07-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedIncomeCategory(DB_URL, user.id, "Salary");

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    // Add form is rendered with the seeded category preselected.
    await expect(page.getByRole("heading", { level: 2, name: "Incomes" })).toBeVisible();
    await page.locator("#new-income-name").fill("Monthly salary");
    await page.locator("#new-income-amount").fill("2000.00");
    await page.getByRole("button", { name: "Add" }).click();

    // Row appears with the expected name + amount label.
    await expect(page.getByText("Monthly salary", { exact: true })).toBeVisible();
    await expect(page.getByText("2000.00 EUR", { exact: true })).toBeVisible();

    // Edit: switch to edit mode, change the amount, save.
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .locator('input[id^="edit-income-name-"]')
      .fill("Year-end bonus");
    await page.locator('input[id^="edit-income-amount-"]').fill("2500.00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Year-end bonus", { exact: true })).toBeVisible();
    await expect(page.getByText("2500.00 EUR", { exact: true })).toBeVisible();

    // Delete (auto-accept the confirm dialog).
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Year-end bonus", { exact: true })).toHaveCount(0);
    await expect(page.getByText("2500.00 EUR", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No incomes yet.")).toBeVisible();

    // Verify the DB row is GONE (PRD C15 / §13 hard delete).
    const remaining = await countIncomeRows(DB_URL, user.id);
    expect(remaining).toBe(0);
  });

  test("no active income categories surfaces the empty-state helper (PRD §6.5)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc07-noact-${Date.now()}@example.com`,
      googleSub: `e2e-uc07-noact-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await expect(
      page.getByText("Create an active income category first."),
    ).toBeVisible();
  });

  test("Spanish variant renders translated copy", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc07-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc07-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedIncomeCategory(DB_URL, user.id, "Salario");

    await page.goto(`${BASE_URL}/es/months/2026/8`);
    await expect(page.getByRole("heading", { level: 2, name: "Ingresos" })).toBeVisible();
    await page.locator("#new-income-name").fill("Salario mensual");
    await page.locator("#new-income-amount").fill("2000.00");
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText("Salario mensual", { exact: true })).toBeVisible();
    await expect(page.getByText("2000.00 EUR", { exact: true })).toBeVisible();
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function attachSessionCookie(context: BrowserContext, user: { id: string; email: string }) {
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
}

async function resetWorkspace(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM month_income WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month_actual_expense WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month_fixed_line WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month WHERE user_id = ${userId}`;
    await sql`DELETE FROM template WHERE user_id = ${userId}`;
    await sql`DELETE FROM category WHERE user_id = ${userId}`;
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

async function seedIncomeCategory(
  dbUrl: string,
  userId: string,
  name: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, ${name}, 'income', true)
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function countIncomeRows(dbUrl: string, userId: string): Promise<number> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM month_income
        WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    `;
    return Number.parseInt(rows[0]?.n ?? "0", 10);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
