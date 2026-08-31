import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";

// ============================================================================
// UC-11 summary, savings & warnings — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03…UC-10 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`.
//
// Acceptance criteria covered (PRD §15 #5, #8, #13, #19):
//   - #5  Mortgage 800 committed + groceries 400 estimated + income 2000
//        → savings 800.00 € on day one.
//   - #8  Pass mortgage to actual → savings STILL 800.00 €; the money
//        lives in exactly one place (PRD §7.2).
//   - #13 Past-month banner shown when opening a non-current month; edits
//        are still allowed.
//   - #19 Food templates 400 + 50, actuals 500 → warning badge appears;
//        month remaining is IGNORED for the warning baseline.
//   - Spanish variant renders the Spanish summary copy (Ahorro potencial,
//        Ingresos, Gastos reales, Reservado) and the warning copy.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-11 summary, savings & warnings", () => {
  test("#5 — fresh month: mortgage 800 + groceries 400 + income 2000 → savings 800.00 €", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-summary-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-summary-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Mortgage");
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedIncomeCategory(DB_URL, user.id, "Salary");
    await seedTemplate(DB_URL, user.id, "Mortgage", "800.00", "committed");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedIncome(DB_URL, user.id, 2026, 8, "Salary", "Salary name", "2000.00");

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    // Savings hero number is 800.00 € (PRD #5).
    await expect(page.getByTestId("summary-savings")).toHaveText("800.00 €");

    // Income / actuals / reserved cells render their own values.
    await expect(page.getByTestId("summary-income")).toHaveText("2000.00 €");
    await expect(page.getByTestId("summary-actuals")).toHaveText("0.00 €");
    await expect(page.getByTestId("summary-reserved")).toHaveText("1200.00 €");
  });

  test("#8 — pass mortgage to actual: savings stays 800.00 €; only the cells change (PRD §7.2)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-pass-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-pass-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Mortgage");
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedIncomeCategory(DB_URL, user.id, "Salary");
    await seedTemplate(DB_URL, user.id, "Mortgage", "800.00", "committed");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedIncome(DB_URL, user.id, 2026, 8, "Salary", "Salary name", "2000.00");

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await page.getByRole("button", { name: /Committed/ }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Pass to actual", exact: true }).click();

    // After the move, savings remains 800.00 € (PRD §7.2: money in
    // exactly one place). Actuals = 800.00, Reserved = 400.00 (groceries).
    await expect(page.getByTestId("summary-savings")).toHaveText("800.00 €");
    await expect(page.getByTestId("summary-actuals")).toHaveText("800.00 €");
    await expect(page.getByTestId("summary-reserved")).toHaveText("400.00 €");
  });

  test("#19 — overspend badge appears when actuals exceed estimated template plan", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-over-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-over-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    const foodId = await seedExpenseCategory(DB_URL, user.id, "Food");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedTemplate(DB_URL, user.id, "Extra", "50.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedActual(DB_URL, user.id, 2026, 8, foodId, "Bread", "500.00");

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    const warningsToggle = page.getByRole("button", { name: /Warnings/ });
    const dataTab = page.getByRole("tab", { name: "Data" });
    await expect(warningsToggle).toBeVisible();
    const warningsBox = await warningsToggle.boundingBox();
    const dataBox = await dataTab.boundingBox();
    expect(warningsBox?.y).toBeLessThan(dataBox?.y ?? Number.POSITIVE_INFINITY);

    await warningsToggle.click();
    await expect(page.getByTestId("overspend-badge")).toBeVisible();
    await expect(page.getByText(/Plan in fixed expenses:/)).toBeVisible();
    await expect(page.getByText(/Over by/)).toBeVisible();
    // Overspend does NOT block — the add form is still usable.
    await expect(page.locator("#new-actual-name")).toBeVisible();
  });

  test("no overspend badge when actuals stay inside the estimated template plan", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-nowarn-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-nowarn-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    const foodId = await seedExpenseCategory(DB_URL, user.id, "Food");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedActual(DB_URL, user.id, 2026, 8, foodId, "Bread", "400.00");

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    expect(await page.getByTestId("overspend-badge").count()).toBe(0);
  });

  test("#13 — past-month banner appears when opening a non-current month", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-past-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-past-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedMonth(DB_URL, user.id, 2099, 1);

    await page.goto(`${BASE_URL}/en/months/2099/1`);

    // Banner copy from PRD §19 / #13.
    await expect(page.getByTestId("past-month-banner")).toBeVisible();
    await expect(
      page.getByText("ATTENTION: This month is not the current calendar month."),
    ).toBeVisible();

    // Edits ARE allowed in past months (PRD §7.7). The add-actual form is
    // still rendered.
    await expect(page.locator("#new-actual-name")).toBeVisible();
  });

  test("Spanish variant renders translated summary + warning copy", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc11-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc11-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    const foodId = await seedExpenseCategory(DB_URL, user.id, "Comida");
    await seedTemplate(DB_URL, user.id, "Supermercado", "400.00", "estimated");
    await seedTemplate(DB_URL, user.id, "Extra", "50.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedActual(DB_URL, user.id, 2026, 8, foodId, "Pan", "500.00");

    await page.goto(`${BASE_URL}/es/months/2026/8`);

    // Spanish summary copy.
    await expect(
      page.getByRole("heading", { level: 2, name: "Ahorro potencial" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Avisos/ }).click();
    await expect(page.getByTestId("overspend-badge")).toBeVisible();
    await expect(page.getByText(/Plan en gastos fijos:/)).toBeVisible();
    await expect(page.getByText(/Excedido por/)).toBeVisible();
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
    await insertMonthCloningTemplates(sql, userId, year, month);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedExpenseCategory(
  dbUrl: string,
  userId: string,
  name: string,
): Promise<string> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, ${name}, 'expense', true)
      RETURNING id
    `;
    if (!row) throw new Error("seedExpenseCategory returned no row");
    return row.id;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedIncomeCategory(
  dbUrl: string,
  userId: string,
  name: string,
): Promise<string> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, ${name}, 'income', true)
      RETURNING id
    `;
    if (!row) throw new Error("seedIncomeCategory returned no row");
    return row.id;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedTemplate(
  dbUrl: string,
  userId: string,
  name: string,
  amount: string,
  kind: "committed" | "estimated",
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [category] = await sql<{ id: string }[]>`
      SELECT id FROM category WHERE user_id = ${userId} AND active = true AND kind = 'expense' LIMIT 1
    `;
    if (!category) throw new Error("seedTemplate: no expense category seeded first");
    await sql`
      INSERT INTO template (user_id, category_id, name, amount, kind, active)
      VALUES (${userId}, ${category.id}, ${name}, ${amount}, ${kind}, true)
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedIncome(
  dbUrl: string,
  userId: string,
  year: number,
  month: number,
  categoryName: string,
  name: string,
  amount: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO month_income (month_id, category_id, name, amount)
      SELECT m.id, c.id, ${name}, ${amount}
        FROM month m
        JOIN category c ON c.user_id = m.user_id
       WHERE m.user_id = ${userId}
         AND m.year = ${year}
         AND m.month = ${month}
         AND c.name = ${categoryName}
         AND c.kind = 'income'
         AND c.active = true
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedActual(
  dbUrl: string,
  userId: string,
  year: number,
  month: number,
  categoryId: string,
  name: string,
  amount: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      SELECT m.id, ${categoryId}, ${name}, ${amount}
        FROM month m
       WHERE m.user_id = ${userId}
         AND m.year = ${year}
         AND m.month = ${month}
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}