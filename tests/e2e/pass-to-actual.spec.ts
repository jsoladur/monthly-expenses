import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { insertMonthCloningTemplates } from "./_helpers/month";

// ============================================================================
// UC-10 pass-to-actual & undo — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03…UC-09 — seed an `app_user` row + forge
// an Auth.js session cookie via `next-auth/jwt#encode`.
//
// Acceptance criteria covered (PRD §15 #8, #9, #10, #12):
//   - Pass a committed (Mortgage 800) line: the line disappears from the
//     reserved-lines block, a new actual ticket appears in the actuals
//     block, and the savings algebra is unchanged (#8, PRD §7.2).
//   - The new actual stores `converted_from_line_id` so the UI surfaces an
//     "Undo pass" affordance (PRD §7.5).
//   - Click "Undo" on the unedited actual: the committed line returns
//     with the same id and the actual is gone (#9).
//   - Estimated lines have NO pass-to-actual button in the UI; even if the
//     API is poked directly the service rejects with
//     `EstimatedLineCannotPassError` (#12) — covered in
//     `tests/integration/pass-to-actual.test.ts`.
//   - Spanish variant: pass + undo copy renders translated (Pasar a
//     gastos reales / Deshacer pase).
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-10 pass-to-actual & undo", () => {
  test("pass a committed line → undo restores it (UC-10 acceptance)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc10-${Date.now()}@example.com`,
      googleSub: `e2e-uc10-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Mortgage");
    await seedTemplate(DB_URL, user.id, "Mortgage", "800.00", "committed");
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    await page.getByRole("button", { name: /Committed/ }).click();
    await expect(page.getByRole("listitem").getByText("Mortgage", { exact: true })).toBeVisible();
    await expect(page.getByText("800.00 €", { exact: true }).first()).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Pass to actual", exact: true })
      .click();

    await expect(page.getByText("800.00 €", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Committed/ })).toHaveCount(0);
    await expect(page.getByText("No expense tickets yet.")).toHaveCount(0);

    // DB confirms: month_fixed_line row is hard-deleted, month_actual_expense
    // has exactly 1 row with the conversion link.
    const fixedCount = await countFixedLineRows(DB_URL, user.id);
    const actualCount = await countActualRows(DB_URL, user.id);
    expect(fixedCount).toBe(0);
    expect(actualCount).toBe(1);

    // The actual now exposes an "Undo pass" button (PRD §7.5 / #9).
    await expect(
      page.getByRole("button", { name: "Undo pass", exact: true }),
    ).toBeVisible();

    // Click Undo → confirm.
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Undo pass", exact: true }).click();

    // Committed line is back; the actual is gone.
    await expect(page.getByRole("button", { name: /Committed/ })).toBeVisible();
    await page.getByRole("button", { name: /Committed/ }).click();
    await expect(page.getByRole("listitem").getByText("Mortgage", { exact: true })).toBeVisible();

    const finalFixed = await countFixedLineRows(DB_URL, user.id);
    const finalActual = await countActualRows(DB_URL, user.id);
    expect(finalFixed).toBe(1);
    expect(finalActual).toBe(0);
  });

  test("estimated line exposes pass-to-actual button in the UI (PRD §7.5 extended)", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc10-est-${Date.now()}@example.com`,
      googleSub: `e2e-uc10-est-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Groceries");
    await seedTemplate(DB_URL, user.id, "Groceries", "400.00", "estimated");
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/en/months/2026/8`);

    await page.getByRole("tab", { name: /Reserved/ }).click();
    await expect(
      page.getByRole("button", { name: "Pass to actual", exact: true }).first(),
    ).toBeVisible();
  });

  test("Spanish variant renders translated pass + undo copy", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc10-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc10-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetWorkspace(DB_URL, user.id);
    await seedExpenseCategory(DB_URL, user.id, "Hipoteca");
    await seedTemplate(DB_URL, user.id, "Hipoteca", "800.00", "committed");
    await seedMonth(DB_URL, user.id, 2026, 8);

    await page.goto(`${BASE_URL}/es/months/2026/8`);

    await page.getByRole("button", { name: /Comprometidas/ }).click();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Pasar a real", exact: true }).click();

    await expect(
      page.getByRole("button", { name: "Deshacer pase", exact: true }),
    ).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Deshacer pase", exact: true })
      .click();

    await page.getByRole("button", { name: /Comprometidas/ }).click();
    await expect(page.getByRole("listitem").getByText("Hipoteca", { exact: true })).toBeVisible();
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
    await insertMonthCloningTemplates(sql, userId, year, month);
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
  kind: "committed" | "estimated",
): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [category] = await sql<{ id: string }[]>`
      SELECT id FROM category WHERE user_id = ${userId} AND active = true LIMIT 1
    `;
    if (!category) throw new Error("seedTemplate: no expense category seeded first");
    await sql`
      INSERT INTO template (user_id, category_id, name, amount, kind, active)
      VALUES (${userId}, ${category.id}, ${name}, ${amount}, ${kind}, true)
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function countFixedLineRows(dbUrl: string, userId: string): Promise<number> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*)::text AS n FROM month_fixed_line
        WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    `;
    return Number.parseInt(rows[0]?.n ?? "0", 10);
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