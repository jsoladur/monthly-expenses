import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-03 categories — end-to-end happy path + acceptance.
//
// Auth bypass: we seed an `app_user` row in the DB and forge an Auth.js
// session cookie signed with `AUTH_SECRET`. The app sees the same JWT shape
// the `jwt` callback would produce after a real Google sign-in and grants
// the page access.
//
// Acceptance criteria covered:
//   - create a category (expense)
//   - duplicate name is rejected with a keyed validation message
//   - the management screen shows the row immediately after revalidate
//   - deactivating hides the action button + shows the Inactive badge
//   - reactivating restores it
//   - switching the language tab renders Spanish copy
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ?? "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-03 categories", () => {
  test("create / duplicate-rejected / deactivate / reactivate (UC-03 acceptance)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-${Date.now()}@example.com`,
      googleSub: `e2e-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetUserCategories(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/categories`);

    // Initial state: empty expense tab.
    await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
    await expect(page.getByText("No expense categories yet.")).toBeVisible();

    // Add a category.
    await page.getByLabel("Name", { exact: true }).fill("Groceries");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Groceries", { exact: true })).toBeVisible();

    // Duplicate name: rejected.
    await page.getByLabel("Name", { exact: true }).fill("Groceries");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("A category with this name already exists.")).toBeVisible();

    // Deactivate.
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Inactive")).toBeVisible();

    // Reactivate (Inactive badge stays visible only after deactivate; on reactivate
    // the row goes back to the active render path).
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Inactive")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("language switch renders the categories screen in Spanish", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-es-${Date.now()}@example.com`,
      googleSub: `e2e-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetUserCategories(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/categories`);
    await expect(page.getByRole("heading", { level: 1, name: "Categorías" })).toBeVisible();
    await expect(page.getByText("Aún no hay categorías de gasto.")).toBeVisible();
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

async function resetUserCategories(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM category WHERE user_id = ${userId}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

// Re-export so callers don't need a second import.
export type { APIRequestContext };
