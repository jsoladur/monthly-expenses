import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { uniqueId } from "./_helpers/unique";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-30 income name autocomplete", () => {
  test("type nó suggests June/July incomes, excludes May and actuals (PRD §15 #74)", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await page.getByRole("tab", { name: /Incomes/ }).click();

    const name = page.locator("#new-income-name");
    await name.click();
    await name.pressSequentially("n");
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await name.pressSequentially("ó");
    const list = page.getByRole("listbox", { name: "Recent names" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option", { name: "Nómina", exact: true })).toBeVisible();
    await expect(list.getByRole("option", { name: "Nómina extra" })).toBeVisible();
    await expect(list.getByRole("option", { name: "Nominal bonus" })).toHaveCount(0);
    await expect(list.getByRole("option", { name: "Nómina gift" })).toHaveCount(0);
  });

  test("picking a suggestion fills the name only (PRD §15 #76)", async ({ context, page }) => {
    const user = await seedSignedIn(context);
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await page.getByRole("tab", { name: /Incomes/ }).click();
    const name = page.locator("#new-income-name");
    await name.click();
    await name.pressSequentially("no");
    await page.getByRole("option", { name: "Nómina", exact: true }).click();
    await expect(name).toHaveValue("Nómina");
    await expect(page.locator("#new-income-amount")).toHaveValue("");
    await expect(page.getByRole("listbox", { name: "Recent names" })).toHaveCount(0);

    await page.locator("#new-income-amount").fill("2000.00");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(
      page.locator("#tabpanel-incomes").getByText("Nómina", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#tabpanel-incomes").getByText("2,000.00 €", { exact: true }),
    ).toBeVisible();
  });

  test("Spanish list label", async ({ context, page }) => {
    const user = await seedSignedIn(context, "es");
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/months/2026/8`);
    await page.getByRole("tab", { name: /Ingresos/ }).click();
    const name = page.locator("#new-income-name");
    await name.click();
    await name.pressSequentially("no");
    await expect(page.getByRole("listbox", { name: "Nombres recientes" })).toBeVisible();
  });
});

async function seedSignedIn(context: BrowserContext, locale: "en" | "es" = "en") {
  const stamp = `${uniqueId()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc30-${locale}-${stamp}@example.com`,
    googleSub: `e2e-uc30-sub-${locale}-${stamp}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
  return user;
}

async function seedWindow(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM month_actual_expense WHERE month_id IN (SELECT id FROM month WHERE workspace_id = ${userId})`;
    await sql`DELETE FROM month_fixed_line WHERE month_id IN (SELECT id FROM month WHERE workspace_id = ${userId})`;
    await sql`DELETE FROM month_income WHERE month_id IN (SELECT id FROM month WHERE workspace_id = ${userId})`;
    await sql`DELETE FROM month WHERE workspace_id = ${userId}`;
    await sql`DELETE FROM category WHERE workspace_id = ${userId}`;

    const [income] = await sql<{ id: string }[]>`
      INSERT INTO category (workspace_id, name, kind, active)
      VALUES (${userId}, 'Salary', 'income', true)
      RETURNING id
    `;
    const [expense] = await sql<{ id: string }[]>`
      INSERT INTO category (workspace_id, name, kind, active)
      VALUES (${userId}, 'Food', 'expense', true)
      RETURNING id
    `;
    if (!income || !expense) throw new Error("seedWindow: category insert failed");

    await sql`
      INSERT INTO month (workspace_id, year, month)
      VALUES
        (${userId}, 2026, 8),
        (${userId}, 2026, 7),
        (${userId}, 2026, 6),
        (${userId}, 2026, 5)
    `;

    const addIncome = (name: string, monthNumber: number) => sql`
      INSERT INTO month_income (month_id, category_id, name, amount)
      SELECT m.id, ${income.id}, ${name}, '1000.00'
        FROM month m
       WHERE m.workspace_id = ${userId} AND m.year = 2026 AND m.month = ${monthNumber}
    `;
    await addIncome("Nómina", 6);
    await addIncome("Nómina extra", 7);
    await addIncome("Nominal bonus", 5);

    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount, created_by_user_id)
      SELECT m.id, ${expense.id}, 'Nómina gift', '3.00', ${userId}
        FROM month m
       WHERE m.workspace_id = ${userId} AND m.year = 2026 AND m.month = 8
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
