import { expect, test, type BrowserContext } from "@playwright/test";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { seedTwoCompleteYearsPlusIncomplete } from "./_helpers/global-stats";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ?? "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-15 global stats", () => {
  test("13 — Stats nav → Overview KPIs for a two-year fixture", async ({ context, page }) => {
    const user = await seedSignedIn(context);
    await seedTwoCompleteYearsPlusIncomplete(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/stats`);
    await expect(page.getByRole("heading", { level: 1, name: "Stats" })).toBeVisible();
    await expect(page.getByTestId("stats-kpi-income")).toBeVisible();
    await expect(page.getByTestId("stats-kpi-spend")).toBeVisible();
    await expect(page.getByTestId("stats-kpi-savings")).toBeVisible();
    await expect(page.getByTestId("chart-income-vs-spend")).toBeVisible();
  });

  test("14 — tabs via ?tab= and the tablist", async ({ context, page }) => {
    const user = await seedSignedIn(context);
    await seedTwoCompleteYearsPlusIncomplete(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/stats?tab=incomes`);
    await expect(page.getByRole("tab", { name: "Incomes" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Expenses" }).click();
    await expect(page).toHaveURL(/tab=expenses/);
    await page.getByRole("tab", { name: "Inflation" }).click();
    await expect(page).toHaveURL(/tab=inflation/);
    await page.getByRole("tab", { name: "Trends" }).click();
    await expect(page).toHaveURL(/tab=trends/);
    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("Enter");
  });

  test("15 — incomplete latest year shows YTD/LFL; Inflation uses LFL by default", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedTwoCompleteYearsPlusIncomplete(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/stats`);
    await expect(page.getByTestId("stats-ytd")).toBeVisible();
    await expect(page.getByTestId("stats-lfl")).toBeVisible();
    await page.goto(`${BASE_URL}/en/stats?tab=inflation`);
    await expect(page.getByTestId("stats-inflation-disclaimer")).toBeVisible();
    await expect(page.getByTestId("stats-lfl")).toBeVisible();
  });

  test("16 — Spanish locale: Estadísticas, Spanish month names, dot-decimal amounts", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedTwoCompleteYearsPlusIncomplete(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/stats`);
    await expect(page.getByRole("heading", { level: 1, name: "Estadísticas" })).toBeVisible();
    await expect(page.getByTestId("stats-kpi-income")).toContainText(/\d+\.\d{2}/);
    await page.goto(`${BASE_URL}/es/stats?tab=expenses`);
    await expect(page.getByTestId("chart-expenses-seasonality")).toContainText(/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i);
  });

  test("17 — empty user: empty state, no chart crash", async ({ context, page }) => {
    await seedSignedIn(context, { emailPrefix: "e2e-stats-empty" });
    await page.goto(`${BASE_URL}/en/stats`);
    await expect(page.getByTestId("stats-empty")).toBeVisible();
    await expect(page.getByTestId("chart-income-vs-spend")).toHaveCount(0);
  });

  test("18 — mobile: 5 items including Stats and More; Annuals from More", async ({
    context,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile nav only");
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en`);
    const nav = page.getByTestId("mobile-nav");
    await expect(nav.getByTestId("nav-stats")).toBeVisible();
    await expect(nav.getByTestId("nav-more")).toBeVisible();
    await expect(nav.getByTestId("nav-home")).toBeVisible();
    await expect(nav.getByTestId("nav-history")).toBeVisible();
    await expect(nav.getByTestId("nav-settings")).toBeVisible();
    await expect(nav.locator("a, button")).toHaveCount(5);
    await nav.getByTestId("nav-more").click();
    await page.getByTestId("nav-annuals-more").click();
    await expect(page).toHaveURL(/\/en\/annuals/);
  });

  test("19 — every Overview chart has a data-table toggle", async ({ context, page }) => {
    const user = await seedSignedIn(context);
    await seedTwoCompleteYearsPlusIncomplete(DB_URL, user.id);
    await page.goto(`${BASE_URL}/en/stats`);
    const toggles = page.getByRole("button", { name: "Show data table" });
    await expect(toggles).toHaveCount(5);
  });
});

async function seedSignedIn(
  context: BrowserContext,
  opts: { emailPrefix?: string } = {},
): Promise<{ id: string; email: string }> {
  const stamp = `${opts.emailPrefix ?? "e2e-stats"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `${stamp}@example.com`,
    googleSub: `sub-${stamp}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
  return user;
}
