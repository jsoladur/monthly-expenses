import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";

// ============================================================================
// UC-26 move an actual expense to another month — end-to-end acceptance.
//
// Proposed PRD §15 #52 (move lands on the target), #53 (3-month backward
// window), #55 (no target → no action on the row).
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

const MOVE = "Move to another month";

test.describe("UC-26 move actual to another month", () => {
  test("moves Dentist from November to December (#52)", async ({ context, page }) => {
    const user = await setupUser(context, "happy");
    const nov = await seedMonth(user.id, 2026, 11);
    await seedMonth(user.id, 2026, 12);
    await seedActual(user.id, nov, "Dentist", "90.00");

    await page.goto(`${BASE_URL}/en/months/2026/11`);
    const row = page.getByRole("listitem").filter({ hasText: "Dentist" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: MOVE, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Later months")).toBeVisible();
    await expect(dialog.getByText("Earlier months")).toHaveCount(0);
    await dialog.getByRole("radio", { name: /December 2026/ }).click();
    await dialog.getByRole("button", { name: "Move to December 2026", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole("status").getByText("Moved to December 2026")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Dentist" })).toHaveCount(0);

    await page.getByRole("status").getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/en\/months\/2026\/12/);
    await expect(page.getByRole("listitem").filter({ hasText: "Dentist" })).toBeVisible();
  });

  test("offers at most 3 months back (#53)", async ({ context, page }) => {
    const user = await setupUser(context, "back");
    await seedMonth(user.id, 2026, 10);
    await seedMonth(user.id, 2026, 11);
    await seedMonth(user.id, 2026, 12);
    await seedMonth(user.id, 2027, 1);
    const feb = await seedMonth(user.id, 2027, 2);
    await seedActual(user.id, feb, "Late bill", "40.00");

    await page.goto(`${BASE_URL}/en/months/2027/2`);
    await page
      .getByRole("listitem")
      .filter({ hasText: "Late bill" })
      .getByRole("button", { name: MOVE, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("radio").first()).toContainText("January 2027");
    await expect(dialog.getByRole("radio", { name: /November 2026/ })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /October 2026/ })).toHaveCount(0);
  });

  test("hides the action when no month is in the window (#55)", async ({ context, page }) => {
    const user = await setupUser(context, "none");
    await seedMonth(user.id, 2026, 6);
    const nov = await seedMonth(user.id, 2026, 11);
    await seedActual(user.id, nov, "Bread", "2.00");

    await page.goto(`${BASE_URL}/en/months/2026/11`);
    await expect(page.getByRole("listitem").filter({ hasText: "Bread" })).toBeVisible();
    await expect(page.getByRole("button", { name: MOVE, exact: true })).toHaveCount(0);
  });

  test("Spanish picker copy", async ({ context, page }) => {
    const user = await setupUser(context, "es");
    await seedMonth(user.id, 2026, 10);
    const nov = await seedMonth(user.id, 2026, 11);
    await seedMonth(user.id, 2026, 12);
    await seedActual(user.id, nov, "Dentista", "90.00");

    await page.goto(`${BASE_URL}/es/months/2026/11`);
    await page.getByRole("button", { name: "Mover a otro mes", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Meses siguientes")).toBeVisible();
    // October 2026 is closed: its figure reads as consolidated savings.
    await expect(
      dialog.getByRole("radio", { name: /octubre de 2026/ }).getByText(/^Ahorro \d/),
    ).toBeVisible();
    await dialog.getByRole("radio", { name: /diciembre de 2026/ }).click();
    await expect(
      dialog.getByRole("button", { name: "Mover a diciembre de 2026", exact: true }),
    ).toBeVisible();
  });
});

async function setupUser(context: BrowserContext, tag: string) {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc26-${stamp}@example.com`,
    googleSub: `e2e-uc26-sub-${stamp}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
  await withSql(async (sql) => {
    await sql`DELETE FROM month WHERE user_id = ${user.id}`;
    await sql`DELETE FROM category WHERE user_id = ${user.id}`;
    await sql`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${user.id}, 'Health', 'expense', true)
    `;
  });
  return user;
}

async function seedMonth(userId: string, year: number, month: number): Promise<string> {
  return withSql((sql) => insertMonthCloningTemplates(sql, userId, year, month));
}

async function seedActual(
  userId: string,
  monthId: string,
  name: string,
  amount: string,
): Promise<void> {
  await withSql(async (sql) => {
    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      SELECT ${monthId}, c.id, ${name}, ${amount}
      FROM category c
      WHERE c.user_id = ${userId} AND c.kind = 'expense'
      LIMIT 1
    `;
  });
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
