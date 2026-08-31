import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-05 templates — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03/UC-04 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`. The app decodes the
// cookie the same way it decodes one produced by a real Google sign-in.
//
// Acceptance criteria covered:
//   - load /<locale>/templates and verify the clone copy is visible
//   - create a committed template (need an active expense category first —
//     the seed inserts one)
//   - the row appears with category + amount in €
//   - deactivate hides the row behind an "Inactive" badge and the action
//     label flips to "Reactivate"
//   - reactivate restores it
//   - the Spanish variant loads the translated copy
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-05 fixed/estimated templates", () => {
  test("create / deactivate / reactivate (UC-05 acceptance)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc05-${Date.now()}@example.com`,
      googleSub: `e2e-uc05-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetUserState(DB_URL, user.id);

    // Seed an active expense category so the picker has options.
    await seedActiveExpenseCategory(DB_URL, user.id, "Groceries");

    await page.goto(`${BASE_URL}/en/templates`);

    // Heading + PRD §19 clone copy.
    await expect(page.getByRole("heading", { level: 1, name: "Fixed expenses" })).toBeVisible();

    // Add a committed template.
    await page.locator("#new-committed-name").fill("Weekly groceries");
    await page.locator("#new-committed-amount").fill("150.00");
    await page.getByRole("button", { name: "Add" }).click();

    // Row appears with category + amount in €.
    await expect(page.getByText("Weekly groceries", { exact: true })).toBeVisible();
    await expect(page.getByText("Groceries · 150.00 €", { exact: true })).toBeVisible();

    // Deactivate.
    await page.getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();

    // Reactivate.
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Inactive", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("long observations keep edit and deactivate buttons visible on a narrow viewport", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc05-obs-${Date.now()}@example.com`,
      googleSub: `e2e-uc05-obs-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetUserState(DB_URL, user.id);
    await seedActiveExpenseCategory(DB_URL, user.id, "Vivienda");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/en/templates`);

    const notes =
      "84 meses - 1ª cuota Oct 2026 - Ult. Cuota Sept 2033 extra payment schedule notes";
    await page.locator("#new-committed-name").fill("Tesla Model 3");
    await page.locator("#new-committed-observations").fill(notes);
    await page.locator("#new-committed-amount").fill("44.33");
    await page.getByRole("button", { name: "Add" }).click();

    const row = page.locator("li").filter({ hasText: "Tesla Model 3" });
    await expect(row.getByRole("button", { name: "Edit" })).toBeInViewport();
    await expect(row.getByRole("button", { name: "Deactivate" })).toBeInViewport();
  });

  test("language switch renders the templates screen in Spanish", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc05-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc05-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetUserState(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/templates`);
    await expect(page.getByRole("heading", { level: 1, name: "Gastos fijos" })).toBeVisible();
    await expect(page.getByText("Aún no hay gastos fijos.")).toBeVisible();
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

async function resetUserState(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM template WHERE user_id = ${userId}`;
    await sql`DELETE FROM category WHERE user_id = ${userId}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedActiveExpenseCategory(
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
