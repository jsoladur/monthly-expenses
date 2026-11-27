import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser, type E2EUser } from "./_helpers/auth";
import { uniqueId } from "./_helpers/unique";

// ============================================================================
// UC-31 collaborative workspaces — end-to-end (PRD UC-33, §15 scenarios 80,
// 88, 91, 92 + Spanish variant).
//
// Seeds users with the auth helper (app_user + private workspace + Owner
// membership) and shared workspaces straight in SQL, then drives the UI.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

const YEAR = new Date().getFullYear();

test.describe("UC-31 collaborative workspaces", () => {
  test("80 — a user with only the private workspace sees today's Home, nav and screens", async ({
    context,
    page,
  }) => {
    const user = await seedUser("80");
    await attachSessionCookie(context, user);
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const food = await insertCategory(sql, user.workspaceId, "Food", "expense");
      const monthId = await insertMonth(sql, user.workspaceId, YEAR, 3);
      await insertActual(sql, monthId, food, user.id, "Bakery", "4.00");
    } finally {
      await sql.end({ timeout: 1 });
    }

    await page.goto(`${BASE_URL}/en`);
    await expect(page.getByRole("link", { name: new RegExp(`March ${YEAR}`) })).toBeVisible();
    await expect(page.getByRole("region", { name: "Workspaces" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/workspace|Added by|Owner|Shared/i);

    await page.goto(`${BASE_URL}/en/months/${YEAR}/3`);
    await expect(page.getByText("Bakery").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/workspace|Added by/i);

    // The one exception: Settings offers "Share with others" and names nothing.
    await page.goto(`${BASE_URL}/en/settings`);
    await expect(page.getByRole("link", { name: "Share with others" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/My private workspace/i);
  });

  test("88 — switching the active workspace changes every section together", async ({
    context,
    page,
  }) => {
    const user = await seedUser("88");
    await attachSessionCookie(context, user);
    const name = `Household ${uniqueId().slice(-6)}`;
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      await insertCategory(sql, user.workspaceId, "PrivateOnlyCat", "expense");
      await insertMonth(sql, user.workspaceId, YEAR, 1);
      const shared = await insertSharedWorkspace(sql, user.id, name, "USD");
      await insertCategory(sql, shared, "SharedOnlyCat", "expense");
      await insertMonth(sql, shared, YEAR, 2);
    } finally {
      await sql.end({ timeout: 1 });
    }

    await page.goto(`${BASE_URL}/en`);
    const list = page.getByRole("region", { name: "Workspaces" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("button", { name: /My private workspace/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("link", { name: new RegExp(`January ${YEAR}`) })).toBeVisible();

    await list.getByRole("button", { name: new RegExp(name) }).click();
    await expect(list.getByRole("button", { name: new RegExp(name) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("link", { name: new RegExp(`February ${YEAR}`) })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`January ${YEAR}`) })).toHaveCount(0);
    await expect(page.getByRole("link", { name: new RegExp(`Switch workspace.*${name}`) }).first()).toBeVisible();

    await page.goto(`${BASE_URL}/en/categories`);
    await expect(page.getByText("SharedOnlyCat")).toBeVisible();
    await expect(page.getByText("PrivateOnlyCat")).toHaveCount(0);

    await page.goto(`${BASE_URL}/en/settings`);
    await expect(page.getByRole("form", { name: "Currency" }).locator("#currency")).toHaveValue("USD");

    await page.goto(`${BASE_URL}/en/history`);
    await expect(page.locator("body")).not.toContainText("PrivateOnlyCat");

    // Back to the private one.
    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("region", { name: "Workspaces" }).getByRole("button", { name: /My private workspace/ }).click();
    await expect(page.getByRole("link", { name: new RegExp(`January ${YEAR}`) })).toBeVisible();
  });

  test("91 — a member can leave; the Owner cannot", async ({ browser }) => {
    const owner = await seedUser("91o");
    const member = await seedUser("91m");
    const name = `Trip ${uniqueId().slice(-6)}`;
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    let wsId: string;
    try {
      wsId = await insertSharedWorkspace(sql, owner.id, name, "EUR");
      await sql`INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (${wsId}, ${member.id}, 'editor')`;
    } finally {
      await sql.end({ timeout: 1 });
    }

    const ownerCtx = await browser.newContext();
    await attachSessionCookie(ownerCtx, owner);
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(`${BASE_URL}/en/workspaces/${wsId}`);
    await expect(ownerPage.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(ownerPage.getByText("Transfer ownership or delete this workspace first")).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Leave workspace" })).toHaveCount(0);
    await ownerCtx.close();

    const memberCtx = await browser.newContext();
    await attachSessionCookie(memberCtx, member);
    const memberPage = await memberCtx.newPage();
    await memberPage.goto(`${BASE_URL}/en/workspaces/${wsId}`);
    memberPage.once("dialog", (d) => void d.accept());
    await memberPage.getByRole("button", { name: "Leave workspace" }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/en/?$`));
    await expect(memberPage.getByRole("region", { name: "Workspaces" })).toHaveCount(0);

    // Access ended: the details page is now not found.
    const res = await memberPage.goto(`${BASE_URL}/en/workspaces/${wsId}`);
    expect(res?.status()).toBe(404);
    await memberCtx.close();
  });

  test("87 — a real workspace id and a random one answer the same 404 to a non-member", async ({
    context,
    page,
  }) => {
    const owner = await seedUser("87o");
    const outsider = await seedUser("87x");
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    let wsId: string;
    try {
      wsId = await insertSharedWorkspace(sql, owner.id, "Hidden", "EUR");
    } finally {
      await sql.end({ timeout: 1 });
    }
    await attachSessionCookie(context, outsider);
    const real = await page.goto(`${BASE_URL}/en/workspaces/${wsId}`);
    const realText = await page.locator("body").innerText();
    const random = await page.goto(`${BASE_URL}/en/workspaces/00000000-0000-4000-8000-000000000000`);
    const randomText = await page.locator("body").innerText();
    expect(real?.status()).toBe(404);
    expect(random?.status()).toBe(404);
    expect(realText).toBe(randomText);
  });

  test("92 — switching workspace clears the last-opened month", async ({ context, page }) => {
    const user = await seedUser("92");
    await attachSessionCookie(context, user);
    const name = `Shared ${uniqueId().slice(-6)}`;
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      await insertMonth(sql, user.workspaceId, YEAR, 4);
      const shared = await insertSharedWorkspace(sql, user.id, name, "EUR");
      await insertMonth(sql, shared, YEAR, 5);
    } finally {
      await sql.end({ timeout: 1 });
    }

    await page.goto(`${BASE_URL}/en/months/${YEAR}/4`);
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === "last_opened_month")?.value)
      .toBe(encodeURIComponent(`${YEAR}-4`));

    await page.goto(`${BASE_URL}/en`);
    await page.getByRole("region", { name: "Workspaces" }).getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("link", { name: new RegExp(`May ${YEAR}`) })).toBeVisible();
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === "last_opened_month"))
      .toBe(false);

    // The private April month is not reachable from the shared workspace.
    const res = await page.goto(`${BASE_URL}/en/months/${YEAR}/4`);
    expect(res?.status()).toBe(404);
  });

  test("Spanish variant — workspace list, labels and roles", async ({ context, page }) => {
    const owner = await seedUser("es-o");
    const user = await seedUser("es");
    await attachSessionCookie(context, user);
    const name = `Casa ${uniqueId().slice(-6)}`;
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const ws = await insertSharedWorkspace(sql, owner.id, name, "EUR");
      await sql`INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (${ws}, ${user.id}, 'reader')`;
    } finally {
      await sql.end({ timeout: 1 });
    }

    await page.goto(`${BASE_URL}/es`);
    const list = page.getByRole("region", { name: "Espacios de trabajo" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("button", { name: /Mi espacio privado/ })).toBeVisible();
    await expect(list.getByRole("button", { name: new RegExp(name) })).toContainText("Lector");
    await expect(list.getByRole("button", { name: new RegExp(name) })).toContainText("Compartido");
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function seedUser(tag: string): Promise<E2EUser> {
  const id = uniqueId();
  return ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-uc31-${tag}-${id}@example.com`,
    googleSub: `e2e-uc31-${tag}-sub-${id}`,
  });
}

async function attachSessionCookie(context: BrowserContext, user: E2EUser) {
  const cookie = await buildSessionCookie({ secret: AUTH_SECRET, userId: user.id, email: user.email });
  await context.addCookies([cookie]);
}

async function insertSharedWorkspace(
  sql: postgres.Sql,
  ownerId: string,
  name: string,
  currency: string,
): Promise<string> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspace (kind, name, currency) VALUES ('shared', ${name}, ${currency}) RETURNING id`;
  await sql`INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (${ws!.id}, ${ownerId}, 'owner')`;
  return ws!.id;
}

async function insertCategory(
  sql: postgres.Sql,
  workspaceId: string,
  name: string,
  kind: "expense" | "income",
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO category (workspace_id, name, kind) VALUES (${workspaceId}, ${name}, ${kind}) RETURNING id`;
  return row!.id;
}

async function insertMonth(sql: postgres.Sql, workspaceId: string, year: number, month: number) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO month (workspace_id, year, month) VALUES (${workspaceId}, ${year}, ${month}) RETURNING id`;
  return row!.id;
}

async function insertActual(
  sql: postgres.Sql,
  monthId: string,
  categoryId: string,
  userId: string,
  name: string,
  amount: string,
) {
  await sql`
    INSERT INTO month_actual_expense (month_id, category_id, name, amount, created_by_user_id)
    VALUES (${monthId}, ${categoryId}, ${name}, ${amount}, ${userId})`;
}
