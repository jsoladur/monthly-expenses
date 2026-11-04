import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-25 estimate check — end-to-end acceptance.
//
// Covered (proposed PRD §15 #47, #49):
//   - past month with Groceries plan 400 / remaining 400 / tickets 120 shows
//     a badge of 1 on the Estimate check tab (no banner — removed by PO)
//   - "Set to 280.00 €" asks for confirmation, then applies; the left-over
//     figure rises by 120 and the panel shows the empty state
//   - "Release all" zeroes the envelope on a past month
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-25 estimate check", () => {
  test("#47 — badge and Set to plan − tickets", async ({ context, page }) => {
    await seedPastMonth(context, "suggest");

    await page.goto(`${BASE_URL}/en/months/2025/3`);
    await expect(page.getByTestId("summary-savings")).toHaveText("2,480.00 €");

    await expect(page.getByTestId("estimate-check-badge")).toHaveText("1");
    await page.getByTestId("month-tab-check").click();

    const sheet = page.getByTestId("estimate-check-panel");
    await expect(sheet.getByTestId("estimate-check-category")).toHaveAttribute(
      "data-flagged",
      "true",
    );
    await sheet.getByRole("button", { name: "Set to 280.00 €" }).click();
    await expect(sheet.getByText("Groceries will keep 280.00 € reserved.")).toBeVisible();
    await sheet.getByTestId("estimate-check-confirm").click();

    await expect(sheet.getByTestId("estimate-check-empty")).toBeVisible();
    await expect(page.getByTestId("summary-savings")).toHaveText("2,600.00 €");
    await expect(page.getByTestId("estimate-check-badge")).toHaveCount(0);
  });

  test("#49 — Release all on a past month", async ({ context, page }) => {
    await seedPastMonth(context, "release");

    await page.goto(`${BASE_URL}/en/months/2025/3`);
    await page.getByTestId("month-tab-check").click();
    const sheet = page.getByTestId("estimate-check-panel");
    await sheet.getByTestId("estimate-check-release").click();
    await sheet.getByTestId("estimate-check-confirm").click();

    await expect(page.getByTestId("summary-savings")).toHaveText("2,880.00 €");
  });
});

// Income 3000; Groceries estimated 400 (remaining 400); ticket 120 — March 2025.
async function seedPastMonth(context: BrowserContext, tag: string) {
  const stamp = `${tag}-${Date.now()}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc25-${stamp}@example.com`,
    googleSub: `e2e-uc25-sub-${stamp}`,
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
        (${user.id}, 'Groceries', 'expense')
      RETURNING id, name`;
    const id = (name: string) => cats.find((c) => c.name === name)!.id;
    const [monthRow] = await sql<{ id: string }[]>`
      INSERT INTO month (user_id, year, month) VALUES (${user.id}, 2025, 3) RETURNING id`;
    await sql`INSERT INTO month_income (month_id, category_id, name, amount)
      VALUES (${monthRow.id}, ${id("Salary")}, 'Pay', '3000.00')`;
    await sql`INSERT INTO month_actual_expense (month_id, category_id, name, amount)
      VALUES (${monthRow.id}, ${id("Groceries")}, 'Market', '120.00')`;
    await sql`INSERT INTO month_fixed_line
        (month_id, category_id, name, kind, origin, original_amount, remaining_amount)
      VALUES
        (${monthRow.id}, ${id("Groceries")}, 'Groceries', 'estimated', 'month_only', '400.00', '400.00')`;
  } finally {
    await sql.end({ timeout: 1 });
  }
  return user;
}
