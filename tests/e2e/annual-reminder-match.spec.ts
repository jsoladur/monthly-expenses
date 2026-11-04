import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";
import { uniqueId } from "./_helpers/unique";

// ============================================================================
// UC-28 annual reminder "already added" state — end-to-end (#62, #65).
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-28 annual reminder added state", () => {
  test("matched reminder collapses to Added; deleting the line restores it (#62, #65)", async ({
    context,
    page,
  }) => {
    const user = await setupUser(context, "added");
    const monthId = await withSql((sql) => insertMonthCloningTemplates(sql, user.id, 2026, 3));
    const lineId = await withSql(async (sql) => {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO month_fixed_line (month_id, category_id, name, remaining_amount, original_amount, kind, origin)
        SELECT ${monthId}, c.id, 'Car insurance 2026', '412.50', '412.50', 'committed', 'month_only'
        FROM category c WHERE c.user_id = ${user.id} AND c.name = 'Transport'
        RETURNING id
      `;
      return row!.id;
    });

    await page.goto(`${BASE_URL}/en/months/2026/3`);
    await page.getByRole("button", { name: /Annual reminders/ }).click();

    const added = page.getByTestId("annual-reminder-added");
    await expect(added).toBeVisible();
    await expect(added).toContainText("Car insurance");
    await expect(added).toContainText(/Added: Car insurance 2026 · .*412\.50/);
    await expect(page.getByText(/Usually charged in/)).toBeHidden();

    const toggle = added.getByRole("button", { name: "Show details" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(added.getByRole("button", { name: "Hide details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(added.getByText(/Usually charged in/)).toBeVisible();

    await withSql((sql) => sql`DELETE FROM month_fixed_line WHERE id = ${lineId}`);
    await page.reload();
    await page.getByRole("button", { name: /Annual reminders/ }).click();
    await expect(page.getByTestId("annual-reminder-added")).toHaveCount(0);
    await expect(page.getByText(/Usually charged in/)).toBeVisible();
  });

  test("Spanish copy", async ({ context, page }) => {
    const user = await setupUser(context, "es");
    const monthId = await withSql((sql) => insertMonthCloningTemplates(sql, user.id, 2026, 3));
    await withSql(
      (sql) => sql`
        INSERT INTO month_actual_expense (month_id, category_id, name, amount)
        SELECT ${monthId}, c.id, 'CAR INSURANCE mapfre', '400.00'
        FROM category c WHERE c.user_id = ${user.id} AND c.name = 'Transport'
      `,
    );

    await page.goto(`${BASE_URL}/es/months/2026/3`);
    await page.getByRole("button", { name: /Recordatorios anuales/ }).click();
    const added = page.getByTestId("annual-reminder-added");
    await expect(added).toContainText(/Añadido: CAR INSURANCE mapfre/);
    await expect(added.getByRole("button", { name: "Ver detalles" })).toBeVisible();
  });
});

async function setupUser(context: BrowserContext, tag: string) {
  const stamp = `${tag}-${uniqueId()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc28-${stamp}@example.com`,
    googleSub: `e2e-uc28-sub-${stamp}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
  await withSql(async (sql) => {
    await sql`DELETE FROM month WHERE user_id = ${user.id}`;
    await sql`DELETE FROM annual WHERE user_id = ${user.id}`;
    await sql`DELETE FROM category WHERE user_id = ${user.id}`;
    const [cat] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${user.id}, 'Transport', 'expense', true)
      RETURNING id
    `;
    await sql`
      INSERT INTO annual (user_id, category_id, name, charge_month, is_direct_debit, active)
      VALUES (${user.id}, ${cat!.id}, 'Car insurance', 3, false, true)
    `;
  });
  return user;
}

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
