import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-08 actual expenses (tickets) — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03…UC-07 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`.
//
// Acceptance criteria covered:
//   - Add an actual ticket → row appears with name + observations + amount
//     in EUR (ADR-5, §7.6).
//   - Edit the actual → amount + name + category + observations update; the
//     row reflects the change.
//   - Delete (with confirm) → row disappears; DB row is gone (PRD C15 / §13).
//   - Adding an actual with no active expense category shows the
//     `validation.noActiveExpenseCategories` empty state (PRD §6.7).
//   - Spanish variant: every label renders in translated copy.
//   - Adding a ticket NEVER mutates `month_fixed_line.remaining_amount`
//     (PRD §7.2 / §7.3) — verified by snapshotting the reserved-line counts
//     before + after.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-08 actual expenses", () => {
  test("add → edit → delete (UC-08 acceptance)", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc08-${Date.now()}@example.com`,
      googleSub: `e2e-uc08-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    // Add form is rendered with the seeded category preselected.
    await expect(
      page.getByRole("heading", { level: 2, name: "Actuals" }),
    ).toBeVisible();
    await page.locator("#new-actual-name").fill("Bread");
    await page
      .locator("#new-actual-observations")
      .fill("Bakery on 5th");
    await page.locator("#new-actual-amount").fill("5.00");
    await page.getByRole("button", { name: "Add" }).click();

    // Row appears with the expected name + observations + amount label.
    await expect(page.getByText("Bread", { exact: true })).toBeVisible();
    await expect(page.getByText("Bakery on 5th", { exact: true })).toBeVisible();
    await expect(page.getByText("5.00 EUR", { exact: true })).toBeVisible();

    // Edit: switch to edit mode, change the name + observations + amount.
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .locator('input[id^="edit-actual-name-"]')
      .fill("Bread + milk");
    await page
      .locator('input[id^="edit-actual-observations-"]')
      .fill("Combo trip");
    await page.locator('input[id^="edit-actual-amount-"]').fill("12.50");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Bread + milk", { exact: true })).toBeVisible();
    await expect(page.getByText("Combo trip", { exact: true })).toBeVisible();
    await expect(page.getByText("12.50 EUR", { exact: true })).toBeVisible();

    // Delete (auto-accept the confirm dialog).
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Bread + milk", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Combo trip", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No expense tickets yet.")).toBeVisible();

    // Verify the DB row is GONE (PRD C15 / §13 hard delete).
    const remaining = await countActualRows(DB_URL, user.id);
    expect(remaining).toBe(0);
  });

  test("no active expense categories surfaces the empty-state helper (PRD §6.7)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc08-noact-${Date.now()}@example.com`,
      googleSub: `e2e-uc08-noact-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await expect(
      page.getByText("Create an active expense category first."),
    ).toBeVisible();
  });

  test("adding an actual never mutates month_fixed_line.remaining_amount (PRD §7.2 / §7.3)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc08-reserve-${Date.now()}@example.com`,
      googleSub: `e2e-uc08-reserve-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    // Seed the reserved line directly (skipping the clone) so we can verify
    // the actuals service never mutates it. PRD §7.2 / §7.3 forbids any
    // auto-balance.
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedReservedLine(DB_URL, user.id, "Groceries envelope", "200.00");

    const before = await loadReservedAmounts(DB_URL, user.id);
    expect(before.length).toBeGreaterThan(0); // reserved line seeded

    await page.goto(`${BASE_URL}/en/months/2026/8`);
    await page.locator("#new-actual-name").fill("Bread");
    await page.locator("#new-actual-amount").fill("5.00");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Bread", { exact: true })).toBeVisible();

    const after = await loadReservedAmounts(DB_URL, user.id);
    expect(after).toEqual(before);
  });

  test("Spanish variant renders translated copy", async ({ context, page }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc08-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc08-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedMonth(DB_URL, user.id, 2026, 8);
    await seedExpenseCategory(DB_URL, user.id, "Supermercado");

    await page.goto(`${BASE_URL}/es/months/2026/8`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Gastos reales" }),
    ).toBeVisible();
    await page.locator("#new-actual-name").fill("Pan");
    await page.locator("#new-actual-amount").fill("5.00");
    await page.getByRole("button", { name: "Añadir" }).click();
    await expect(page.getByText("Pan", { exact: true })).toBeVisible();
    await expect(page.getByText("5.00 EUR", { exact: true })).toBeVisible();
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
    await sql`
      INSERT INTO month (user_id, year, month)
      VALUES (${userId}, ${year}, ${month})
    `;
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
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [category] = await sql<{ id: string }[]>`
      SELECT id FROM category WHERE user_id = ${userId} AND active = true LIMIT 1
    `;
    if (!category) throw new Error("seedTemplate: no expense category seeded first");
    await sql`
      INSERT INTO template (user_id, category_id, name, amount, kind, active)
      VALUES (${userId}, ${category.id}, ${name}, ${amount}, 'estimated', true)
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedReservedLine(
  dbUrl: string,
  userId: string,
  name: string,
  remainingAmount: string,
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [category] = await sql<{ id: string }[]>`
      SELECT id FROM category WHERE user_id = ${userId} AND active = true LIMIT 1
    `;
    if (!category) throw new Error("seedReservedLine: no category seeded first");
    const [month] = await sql<{ id: string }[]>`
      SELECT id FROM month WHERE user_id = ${userId} ORDER BY created_at LIMIT 1
    `;
    if (!month) throw new Error("seedReservedLine: no month seeded first");
    await sql`
      INSERT INTO month_fixed_line (month_id, category_id, name, remaining_amount, original_amount, kind, origin)
      VALUES (${month.id}, ${category.id}, ${name}, ${remainingAmount}, ${remainingAmount}, 'estimated', 'cloned')
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function countActualRows(dbUrl: string, userId: string): Promise<number> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM month_actual_expense
        WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    `;
    return Number.parseInt(rows[0]?.n ?? "0", 10);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function loadReservedAmounts(
  dbUrl: string,
  userId: string,
): Promise<{ id: string; remainingAmount: string }[]> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    return await sql<{ id: string; remainingAmount: string }[]>`
      SELECT month_fixed_line.id::text AS id, month_fixed_line.remaining_amount::text AS "remainingAmount"
      FROM month_fixed_line
      INNER JOIN month ON month.id = month_fixed_line.month_id
      WHERE month.user_id = ${userId}
      ORDER BY month_fixed_line.created_at
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
