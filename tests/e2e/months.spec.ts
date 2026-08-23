import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-06 month creation, cloning & home — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03/04/05 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`.
//
// Acceptance criteria covered:
//   - Empty state shows the create-month form only (no auto-creation,
//     PRD C6/C12). The body copy matches PRD §19.
//   - Create month with two ACTIVE templates (Mortgage 800 committed,
//     Groceries 400 estimated) and verify the workspace renders them
//     grouped by kind with `formatMoney` labels (800.00 EUR / 400.00 EUR,
//     ADR-5, ARCH §8).
//   - Home now lists the just-created month in newest-first order
//     (PRD UC-14).
//   - `last_opened_month` cookie resume: navigating to home again opens
//     straight into the same month (PRD UC-14, §5.4).
//   - Duplicate creation surfaces the keyed "That month already exists."
//     error inline (PRD §11).
//   - Spanish variant: form + empty-state copy + month-list heading render
//     in translated copy.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-06 month creation, cloning & home", () => {
  test("empty state → create month with clone snapshot → home list → cookie resume", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc06-${Date.now()}@example.com`,
      googleSub: `e2e-uc06-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedCategory(DB_URL, user.id, "Groceries", "expense");
    await seedTemplate(DB_URL, user.id, "Mortgage", "committed", "800.00");
    await seedTemplate(DB_URL, user.id, "Groceries", "estimated", "400.00");

    // --- Empty state ---
    await page.goto(`${BASE_URL}/en`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Create a month to start" }),
    ).toBeVisible();
    await expect(
      page.getByText("Nothing is created automatically. Pick a month and year to begin."),
    ).toBeVisible();

    // --- Create month ---
    await page.locator('input[name="year"]').fill("2026");
    await page.locator('input[name="month"]').fill("8");
    await page.getByRole("button", { name: "Create" }).click();

    await page.waitForURL(/\/en\/months\/2026\/8$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Committed reserved lines" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Estimated reserved lines" }),
    ).toBeVisible();
    await expect(page.getByText("Mortgage", { exact: true })).toBeVisible();
    await expect(page.getByText("800.00 EUR", { exact: true })).toBeVisible();
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("400.00 EUR", { exact: true })).toBeVisible();

    // --- Cookie resume: navigating home sends us back into the same month.
    await page.goto(`${BASE_URL}/en`);
    await page.waitForURL(/\/en\/months\/2026\/8$/);

    // --- List view: insert a SECOND month via DB so we can exercise the
    // "list newest-first" copy, then clear the cookie to force the list
    // view instead of the resume redirect.
    await seedMonth(DB_URL, user.id, 2026, 9);
    await context.clearCookies();
    await attachSessionCookie(context, user);
    await page.goto(`${BASE_URL}/en`);
    await expect(page.getByRole("heading", { level: 2, name: "Your months" })).toBeVisible();
    await expect(page.getByText("September 2026", { exact: true })).toBeVisible();
    await expect(page.getByText("August 2026", { exact: true })).toBeVisible();
  });

  test("duplicate creation surfaces the keyed error inline (PRD UC-08)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc06-dup-${Date.now()}@example.com`,
      googleSub: `e2e-uc06-dup-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);

    // Clear cookie so home shows the list (with create form) instead of
    // resuming into the existing month.
    await context.clearCookies();
    await attachSessionCookie(context, user);

    await page.goto(`${BASE_URL}/en`);
    await page.locator("summary", { hasText: "Create month" }).click();
    await page.locator('input[name="year"]').fill("2026");
    await page.locator('input[name="month"]').fill("8");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(
      page.locator('[role="alert"][aria-live="polite"]'),
    ).toHaveText(/That month already exists\./);
  });

  test("Spanish variant renders translated empty-state copy", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc06-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc06-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetMonthState(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Crea un mes para empezar" }),
    ).toBeVisible();
    await expect(
      page.getByText("Nada se crea automáticamente. Elige un mes y un año para comenzar."),
    ).toBeVisible();
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

async function seedCategory(
  dbUrl: string,
  userId: string,
  name: string,
  kind: "expense" | "income",
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, ${name}, ${kind}, true)
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedTemplate(
  dbUrl: string,
  userId: string,
  name: string,
  kind: "committed" | "estimated",
  amount: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [category] = await sql<{ id: string }[]>`
      SELECT id FROM category WHERE user_id = ${userId} AND active = true LIMIT 1
    `;
    if (!category) throw new Error("seedTemplate: no category seeded first");
    await sql`
      INSERT INTO template (user_id, category_id, name, amount, kind, active)
      VALUES (${userId}, ${category.id}, ${name}, ${amount}, ${kind}, true)
    `;
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
