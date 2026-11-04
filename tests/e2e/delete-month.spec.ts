import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";

// ============================================================================
// UC-27 delete a month — end-to-end acceptance.
//
// Proposed PRD §15 #58 (rows gone, other months stay) through the UI and
// #60 (last-opened cookie cleared, Home lists months, nothing auto-created).
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-27 delete month", () => {
  test("typed confirmation deletes the month and clears the resume cookie (#58, #60)", async ({
    context,
    page,
  }) => {
    const user = await setupUser(context, "happy");
    const year = new Date().getFullYear();
    const target = await seedMonth(user.id, year, 11);
    await seedMonth(user.id, year, 10);
    await seedActual(user.id, target, "Dentist", "90.00");

    await page.goto(`${BASE_URL}/en/months/${year}/11`);
    // The workspace writes the resume hint on mount.
    await expect.poll(async () => lastOpened(context)).toBe(`${year}-11`);

    await page.getByRole("button", { name: "Month actions" }).click();
    await page.getByRole("menuitem", { name: "Delete month" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText(`Delete November ${year}?`)).toBeVisible();
    await expect(dialog.getByText("1 actual expense")).toBeVisible();
    await expect(dialog.getByText("No incomes")).toBeVisible();

    const confirm = dialog.getByRole("button", { name: "Delete month" });
    const input = dialog.getByRole("textbox");
    await expect(confirm).toBeDisabled();
    await input.fill(`October ${year}`);
    await expect(confirm).toBeDisabled();
    await input.fill(`  november ${year} `);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page).toHaveURL(new RegExp(`/en\\?deleted=${year}-11$`));
    await expect(page.getByRole("status")).toHaveText(`November ${year} was deleted.`);
    const list = page.getByRole("list").filter({ hasText: `October ${year}` });
    await expect(list.getByRole("link")).toHaveCount(1);
    expect(await lastOpened(context)).toBeUndefined();

    const rows = await withSql(
      (sql) => sql`SELECT month FROM month WHERE user_id = ${user.id} ORDER BY month`,
    );
    expect(rows.map((r) => r.month)).toEqual([10]);
    const orphans = await withSql(
      (sql) => sql`SELECT 1 FROM month_actual_expense WHERE month_id = ${target}`,
    );
    expect(orphans).toHaveLength(0);
  });

  test("cancel keeps the month", async ({ context, page }) => {
    const user = await setupUser(context, "cancel");
    await seedMonth(user.id, 2026, 11);

    await page.goto(`${BASE_URL}/en/months/2026/11`);
    await page.getByRole("button", { name: "Month actions" }).click();
    await page.getByRole("menuitem", { name: "Delete month" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("textbox").fill("November 2026");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
    const rows = await withSql((sql) => sql`SELECT 1 FROM month WHERE user_id = ${user.id}`);
    expect(rows).toHaveLength(1);
  });

  test("Spanish label must be typed as shown", async ({ context, page }) => {
    const user = await setupUser(context, "es");
    await seedMonth(user.id, 2026, 11);

    await page.goto(`${BASE_URL}/es/months/2026/11`);
    await page.getByRole("button", { name: "Acciones del mes" }).click();
    await page.getByRole("menuitem", { name: "Eliminar mes" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("¿Eliminar noviembre de 2026?")).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "Eliminar mes" });
    await dialog.getByRole("textbox").fill("November 2026");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("Noviembre de 2026");
    await expect(confirm).toBeEnabled();
  });
});

async function lastOpened(context: BrowserContext): Promise<string | undefined> {
  const cookie = (await context.cookies()).find((c) => c.name === "last_opened_month");
  return cookie ? decodeURIComponent(cookie.value) : undefined;
}

async function setupUser(context: BrowserContext, tag: string) {
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc27-${stamp}@example.com`,
    googleSub: `e2e-uc27-sub-${stamp}`,
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
