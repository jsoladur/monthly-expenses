import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { uniqueId } from "./_helpers/unique";

// ============================================================================
// UC-24 savings categories — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03…UC-20 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`.
//
// Covered (proposed PRD §15 #41, #42):
//   - the Categories switch flips "Investment" to a savings category
//   - the month hero then reads Left over 1400 + Invested 500 = Total saved
//     1900; "Spending (excl. invested)" 1100 appears under
//     "Total Expenses (incl. invested)"
//   - flipping back hides the savings line again
//   - Spanish copy: "Sobrante" / "Invertido" / "Ahorro total"
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-24 savings categories", () => {
  test("#41/#42 — toggle Investment as savings; summary shows the savings line", async ({
    context,
    page,
  }) => {
    const user = await seedUserWithSplitMonth(context, "en");

    await page.goto(`${BASE_URL}/en/categories`);
    const row = page.getByRole("listitem").filter({ hasText: "Investment" });
    const toggle = row.getByRole("switch", { name: "Counts as savings" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(row.getByText("Savings", { exact: true })).toBeVisible();

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await expect(page.getByRole("heading", { level: 2, name: "Left over" })).toBeVisible();
    await expect(page.getByTestId("summary-savings")).toHaveText("1,400.00 €");
    await expect(page.getByTestId("summary-invested")).toHaveText("500.00 €");
    await expect(page.getByTestId("summary-total-saved")).toHaveText("1,900.00 €");
    await expect(page.getByTestId("summary-spending")).toHaveText("1,100.00 €");
    await expect(page.getByText("Total Expenses (incl. invested)")).toBeVisible();
    await expect(page.getByText("Spending (excl. invested)")).toBeVisible();

    await setSavings(DB_URL, user.id, false);
    await page.reload();
    await expect(page.getByTestId("summary-savings")).toHaveText("1,400.00 €");
    await expect(page.getByTestId("summary-invested")).toHaveCount(0);
    await expect(page.getByText("Total Expenses", { exact: true })).toBeVisible();
  });

  test("Spanish copy for the savings line", async ({ context, page }) => {
    const user = await seedUserWithSplitMonth(context, "es");
    await setSavings(DB_URL, user.id, true);

    await page.goto(`${BASE_URL}/es/months/2026/8`);
    await expect(page.getByRole("heading", { level: 2, name: "Sobrante" })).toBeVisible();
    await expect(page.getByText("Invertido", { exact: true })).toBeVisible();
    await expect(page.getByText("Ahorro total", { exact: true })).toBeVisible();
    await expect(page.getByText("Total gastos (incl. invertido)")).toBeVisible();
    await expect(page.getByText("Gasto (excl. invertido)")).toBeVisible();
  });
});

// Income 3000; Food actual 300; Mortgage 800 (Housing) and Pension 500
// (Investment) reserved. Investment starts as a plain expense category.
async function seedUserWithSplitMonth(context: BrowserContext, tag: string) {
  const stamp = `${tag}-${uniqueId()}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc24-${stamp}@example.com`,
    googleSub: `e2e-uc24-sub-${stamp}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);

  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM month WHERE user_id = ${user.id}`;
    await sql`DELETE FROM template WHERE user_id = ${user.id}`;
    await sql`DELETE FROM annual WHERE user_id = ${user.id}`;
    await sql`DELETE FROM category WHERE user_id = ${user.id}`;
    const cats = await sql<{ id: string; name: string }[]>`
      INSERT INTO category (user_id, name, kind) VALUES
        (${user.id}, 'Salary', 'income'),
        (${user.id}, 'Food', 'expense'),
        (${user.id}, 'Housing', 'expense'),
        (${user.id}, 'Investment', 'expense')
      RETURNING id, name`;
    const id = (name: string) => cats.find((c) => c.name === name)!.id;
    const [monthRow] = await sql<{ id: string }[]>`
      INSERT INTO month (user_id, year, month) VALUES (${user.id}, 2026, 8) RETURNING id`;
    await sql`INSERT INTO month_income (month_id, category_id, name, amount)
      VALUES (${monthRow.id}, ${id("Salary")}, 'Pay', '3000.00')`;
    await sql`INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      VALUES (${monthRow.id}, ${id("Food")}, 'Groceries', '300.00')`;
    await sql`INSERT INTO month_fixed_line
        (month_id, category_id, name, kind, origin, original_amount, remaining_amount)
      VALUES
        (${monthRow.id}, ${id("Housing")}, 'Mortgage', 'committed', 'month_only', '800.00', '800.00'),
        (${monthRow.id}, ${id("Investment")}, 'Pension', 'committed', 'month_only', '500.00', '500.00')`;
  } finally {
    await sql.end({ timeout: 1 });
  }
  return user;
}

async function setSavings(dbUrl: string, userId: string, value: boolean): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`UPDATE category SET counts_as_savings = ${value}
      WHERE user_id = ${userId} AND name = 'Investment'`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
