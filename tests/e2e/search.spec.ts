import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-16 search", () => {
  test("18 — More → Search on mobile; desktop sidebar Search after Fixed", async ({
    context,
    page,
  }, testInfo) => {
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en`);

    if (testInfo.project.name === "mobile-safari") {
      const nav = page.getByTestId("mobile-nav");
      await nav.getByTestId("nav-more").click();
      await expect(page.locator("ul [data-testid$='-more']").first()).toHaveAttribute(
        "data-testid",
        "nav-search-more",
      );
      await page.getByTestId("nav-search-more").click();
      await expect(page).toHaveURL(/\/en\/search/);
      return;
    }

    const ids = await page.locator("aside nav a").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")),
    );
    expect(ids.indexOf("nav-search")).toBe(ids.indexOf("nav-templates") + 1);
    await page.getByTestId("nav-search").click();
    await expect(page).toHaveURL(/\/en\/search/);
  });

  test("19 — idle copy is visible; no ticket list until submit", async ({ context, page }) => {
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en/search`);
    await expect(
      page.getByText("Find a ticket from any year. Search matches the name or the note."),
    ).toBeVisible();
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
  });

  test("20-21 — submit match shows a read-only ticket; tap opens the month", async ({
    context,
    page,
  }) => {
    const user = await seedSignedIn(context);
    await seedTicket(DB_URL, user.id);

    await page.goto(`${BASE_URL}/en/search`);
    await page.locator("#search-q").fill("cafe");
    await page.getByTestId("search-submit").click();

    await expect(page).toHaveURL(/q=cafe/);
    const hit = page.getByTestId("search-hit");
    await expect(hit).toHaveCount(1);
    await expect(hit.getByText("Café Central", { exact: true })).toBeVisible();
    await expect(hit.getByText("Food", { exact: true })).toBeVisible();
    await expect(hit.getByText("oat milk", { exact: true })).toBeVisible();
    await expect(hit.getByText("4.50 €", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo pass" })).toHaveCount(0);

    await hit.click();
    await expect(page).toHaveURL(/\/en\/months\/2026\/3/);
  });

  test("22 — Spanish: Buscar, month names, dot-decimal amounts", async ({ context, page }) => {
    const user = await seedSignedIn(context);
    await seedTicket(DB_URL, user.id);

    await page.goto(`${BASE_URL}/es/search`);
    await expect(page.getByRole("heading", { level: 1, name: "Buscar" })).toBeVisible();
    await page.locator("#search-q").fill("cafe");
    await page.getByTestId("search-submit").click();

    const hit = page.getByTestId("search-hit");
    await expect(hit.getByText("4.50 €", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 4, name: /marzo/i })).toBeVisible();
  });

  test("23 — submit stays disabled until the query is at least 2 characters", async ({
    context,
    page,
  }) => {
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en/search`);
    const submit = page.getByTestId("search-submit");
    await page.locator("#search-q").fill("a");
    await expect(submit).toBeDisabled();
    await page.locator("#search-q").press("Enter");
    await expect(page).toHaveURL(/\/en\/search\/?$/);
    await page.locator("#search-q").fill("ab");
    await expect(submit).toBeEnabled();

    await page.goto(`${BASE_URL}/en/search?q=a`);
    await expect(page.getByRole("alert")).toHaveText("Type at least two letters.");
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
  });

  test("24 — no-match query shows empty copy with the typed q", async ({ context, page }) => {
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en/search`);
    await page.locator("#search-q").fill("zzzz");
    await page.getByTestId("search-submit").click();
    await expect(page.getByText('No tickets match “zzzz”. Try another word.')).toBeVisible();
  });

  test("25 — mobile still has exactly 5 bottom items; Search is in More", async ({
    context,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-safari", "Mobile nav only");
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en`);
    const nav = page.getByTestId("mobile-nav");
    await expect(nav.locator("a, button")).toHaveCount(5);
    await expect(nav.getByTestId("nav-search")).toHaveCount(0);
    await nav.getByTestId("nav-more").click();
    await expect(page.getByTestId("nav-search-more")).toBeVisible();
  });
});

async function seedSignedIn(
  context: BrowserContext,
  opts: { emailPrefix?: string } = {},
): Promise<{ id: string; email: string }> {
  const stamp = `${opts.emailPrefix ?? "e2e-search"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

async function seedTicket(dbUrl: string, userId: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO month (user_id, year, month)
      VALUES (${userId}, 2026, 3)
    `;
    const [category] = await sql<{ id: string }[]>`
      INSERT INTO category (user_id, name, kind, active)
      VALUES (${userId}, 'Food', 'expense', true)
      RETURNING id
    `;
    if (!category) throw new Error("seedTicket: category insert failed");
    await sql`
      INSERT INTO month_actual_expense (month_id, category_id, name, observations, amount)
      SELECT m.id, ${category.id}, 'Café Central', 'oat milk', '4.50'
        FROM month m
       WHERE m.user_id = ${userId}
         AND m.year = 2026
         AND m.month = 3
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
