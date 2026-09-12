import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";

// ============================================================================
// UC-18 pass estimated line to an upcoming month — end-to-end acceptance.
//
// PRD §15 #29, #30: button only when later months of the current year exist;
// the move lands on the target Estimated tab as a month-only estimate.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-18 pass to upcoming month", () => {
  test("pass September estimate to existing October (PRD #29)", async ({
    context,
    page,
  }) => {
    const year = new Date().getFullYear();
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc18-${Date.now()}@example.com`,
      googleSub: `e2e-uc18-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, year, 9);
    await seedMonth(DB_URL, user.id, year, 10);

    await page.goto(`${BASE_URL}/en/months/${year}/9`);
    await page.getByRole("tab", { name: /Estimated/ }).click();
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Pass to upcoming month", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Pass to upcoming month")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "October" })).toBeVisible();
    await dialog.getByRole("button", { name: "Pass", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("listitem").filter({ hasText: "Groceries" })).toHaveCount(0);

    await page.goto(`${BASE_URL}/en/months/${year}/10`);
    await page.getByRole("tab", { name: /Estimated/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "One-off this month" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Groceries" })).toHaveCount(2);
  });

  test("hides the button when no later month exists this year (PRD #30)", async ({
    context,
    page,
  }) => {
    const year = new Date().getFullYear();
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc18-none-${Date.now()}@example.com`,
      googleSub: `e2e-uc18-none-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, year, 9);

    await page.goto(`${BASE_URL}/en/months/${year}/9`);
    await page.getByRole("tab", { name: /Estimated/ }).click();
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pass to upcoming month", exact: true })).toHaveCount(
      0,
    );
  });

  test("hides the button on History months even when later months exist (PRD #30)", async ({
    context,
    page,
  }) => {
    const year = new Date().getFullYear() - 1;
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc18-hist-${Date.now()}@example.com`,
      googleSub: `e2e-uc18-hist-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, year, 9);
    await seedMonth(DB_URL, user.id, year, 10);

    await page.goto(`${BASE_URL}/en/months/${year}/9?from=history`);
    await page.getByRole("tab", { name: /Estimated/ }).click();
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pass to upcoming month", exact: true })).toHaveCount(
      0,
    );
  });

  test("Spanish variant renders translated picker copy", async ({ context, page }) => {
    const year = new Date().getFullYear();
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc18-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc18-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Comida");
    await seedTemplate(DB_URL, user.id, "Comida", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, year, 9);
    await seedMonth(DB_URL, user.id, year, 10);

    await page.goto(`${BASE_URL}/es/months/${year}/9`);
    await page.getByRole("tab", { name: /Estimado/ }).click();
    await page.getByRole("button", { name: "Pasar a un mes próximo", exact: true }).click();
    await expect(page.getByRole("dialog").getByText("Pasar a un mes próximo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pasar", exact: true })).toBeVisible();
  });
});

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
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, ${name}, 'expense', true)
    `;
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
      SELECT id FROM category WHERE user_id = ${userId} AND active = true LIMIT 1
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
