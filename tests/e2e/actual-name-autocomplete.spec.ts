import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-17 actual name autocomplete", () => {
  test("type ca suggests June/July names and excludes May (PRD §15 #26)", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await expect(page.getByRole("tab", { name: /Actuals/ })).toBeVisible();

    const name = page.locator("#new-actual-name");
    await name.click();
    await name.pressSequentially("c");
    await expect(page.getByRole("listbox")).toHaveCount(0);

    await name.pressSequentially("a");
    const list = page.getByRole("listbox", { name: "Recent names" });
    await expect(list).toBeVisible();
    await expect(page.getByRole("option", { name: "Café Central" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Carrefour" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Cafeteria" })).toHaveCount(0);
  });

  test("picking a suggestion fills the name only (PRD §15 #28)", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    const name = page.locator("#new-actual-name");
    await name.click();
    await name.pressSequentially("ca");
    await page.getByRole("option", { name: "Café Central" }).click();
    await expect(name).toHaveValue("Café Central");
    await expect(page.locator("#new-actual-amount")).toHaveValue("");
    await expect(page.getByRole("listbox", { name: "Recent names" })).toHaveCount(0);

    await page.locator("#new-actual-amount").fill("4.50");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Café Central", { exact: true })).toBeVisible();
    await expect(page.locator("#tabpanel-actuals").getByText("4.50 €", { exact: true })).toBeVisible();
  });

  test("Spanish list label", async ({ context, page }) => {
    const user = await seedSignedIn(context, "es");
    await seedWindow(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/months/2026/8`);
    const name = page.locator("#new-actual-name");
    await name.click();
    await name.pressSequentially("ca");
    await expect(page.getByRole("listbox", { name: "Nombres recientes" })).toBeVisible();
  });
});

async function seedSignedIn(context: BrowserContext, locale: "en" | "es" = "en") {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc17-${locale}-${stamp}@example.com`,
    googleSub: `e2e-uc17-sub-${locale}-${stamp}`,
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
    await sql`DELETE FROM month_actual_expense WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month_fixed_line WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month_income WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})`;
    await sql`DELETE FROM month WHERE user_id = ${userId}`;
    await sql`DELETE FROM category WHERE user_id = ${userId}`;

    const [category] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, 'Food', 'expense', true)
      RETURNING id
    `;
    if (!category) throw new Error("seedWindow: category insert failed");

    await sql`
      INSERT INTO month (user_id, year, month)
      VALUES
        (${userId}, 2026, 8),
        (${userId}, 2026, 7),
        (${userId}, 2026, 6),
        (${userId}, 2026, 5)
    `;

    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      SELECT m.id, ${category.id}, 'Café Central', '4.50'
        FROM month m
       WHERE m.user_id = ${userId} AND m.year = 2026 AND m.month = 6
    `;
    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      SELECT m.id, ${category.id}, 'Carrefour', '20.00'
        FROM month m
       WHERE m.user_id = ${userId} AND m.year = 2026 AND m.month = 7
    `;
    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      SELECT m.id, ${category.id}, 'Cafeteria', '3.00'
        FROM month m
       WHERE m.user_id = ${userId} AND m.year = 2026 AND m.month = 5
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
