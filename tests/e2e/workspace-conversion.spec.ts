import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser, type E2EUser } from "./_helpers/auth";

// ============================================================================
// UC-33 convert private ↔ shared — end-to-end (PRD UC-35, §15 scenarios 104
// and 108 through the UI, the confirmation steps, cancel, Spanish variant).
//
// No allowlist check is involved (members are seeded in SQL), so the spec
// runs against any dev server.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

function emails(project: string) {
  return {
    owner: `e2e-uc33-owner-${project}@example.com`,
    member: `e2e-uc33-member-${project}@example.com`,
  };
}

test.describe("UC-33 convert private ↔ shared", () => {
  // The tests of one browser project share its fixed users; each resets them.
  test.describe.configure({ mode: "serial" });

  test("104 — share the private workspace in two steps; its data comes along", async ({ browser }, info) => {
    const { owner } = await resetUsers(info.project.name);
    await seedCategory(owner.workspaceId, "Groceries UC33");
    const name = `Our flat ${info.project.name}`;

    const ctx = await signedIn(browser, owner);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/en/workspaces`);
    await page.getByTestId("share-private-workspace").click();

    // Step 1: explain + counts + name.
    await expect(page.getByText("Step 1 of 2")).toBeVisible();
    await expect(page.getByText("You get a new, empty private workspace.").first()).toBeVisible();
    await expect(page.getByText("1 category", { exact: true })).toBeVisible();
    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeDisabled();
    await page.getByLabel("Name of the shared workspace").fill(name);
    await continueBtn.click();

    // Step 2: typed name gates the Share button.
    await expect(page.getByText("Step 2 of 2")).toBeVisible();
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expect(share).toBeDisabled();
    await page.getByLabel("Type the name to confirm").fill(name.toUpperCase());
    await share.click();

    // Lands on the (now shared) workspace with the one-time notice.
    await expect(page).toHaveURL(new RegExp(`/en/workspaces/${owner.workspaceId}`));
    await expect(
      page.getByText("Your private workspace is now shared. You have a new, empty private workspace."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // Same id, same rows; plus a fresh, empty private workspace.
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const [ws] = await sql<{ kind: string; name: string }[]>`
        SELECT kind, name FROM workspace WHERE id = ${owner.workspaceId}`;
      expect(ws).toEqual({ kind: "shared", name });
      const [cat] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM category WHERE workspace_id = ${owner.workspaceId}`;
      expect(cat?.n).toBe(1);
      const [priv] = await sql<{ id: string }[]>`
        SELECT id FROM workspace WHERE personal_user_id = ${owner.id}`;
      expect(priv?.id).toBeTruthy();
      expect(priv?.id).not.toBe(owner.workspaceId);
    } finally {
      await sql.end({ timeout: 1 });
    }
    await ctx.close();
  });

  test("107 — cancelling the share flow changes nothing", async ({ browser }, info) => {
    const { owner } = await resetUsers(info.project.name);
    const ctx = await signedIn(browser, owner);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/en/workspaces`);
    await page.getByTestId("share-private-workspace").click();
    await page.getByLabel("Name of the shared workspace").fill("Never");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Step 2 of 2")).toHaveCount(0);
    expect(await kindOf(owner.workspaceId)).toBe("private");
    await ctx.close();
  });

  test("108 — make a shared workspace private in three steps", async ({ browser }, info) => {
    const { owner, member } = await resetUsers(info.project.name);
    await seedCategory(owner.workspaceId, "Old private UC33");
    const name = `Household ${info.project.name}`;
    const sharedId = await seedShared(name, owner, member);
    await seedCategory(sharedId, "Shared UC33");

    const ctx = await signedIn(browser, owner);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/en/workspaces/${sharedId}`);
    await page.getByTestId("make-private-workspace").click();

    // Step 1: what you lose (+ optional export).
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
    await expect(page.getByText("permanently deleted")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export my private workspace first" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: who loses access + acknowledgement.
    await expect(page.getByText("Step 2 of 3")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Mara")).toBeVisible();
    const next = page.getByRole("button", { name: "Continue" });
    await expect(next).toBeDisabled();
    await page.getByLabel("I understand my current private data will be deleted").check();
    await next.click();

    // Step 3: typed name.
    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    const confirm = page.getByRole("button", { name: "Make private" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type the name to confirm").fill(name);
    await confirm.click();

    await expect(page.getByText(`${name} is now your private workspace.`)).toBeVisible();

    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const [ws] = await sql<{ kind: string; personal_user_id: string }[]>`
        SELECT kind, personal_user_id FROM workspace WHERE id = ${sharedId}`;
      expect(ws).toEqual({ kind: "private", personal_user_id: owner.id });
      const gone = await sql`SELECT 1 FROM workspace WHERE id = ${owner.workspaceId}`;
      expect(gone).toHaveLength(0);
      const members = await sql<{ user_id: string }[]>`
        SELECT user_id FROM workspace_member WHERE workspace_id = ${sharedId}`;
      expect(members.map((m) => m.user_id)).toEqual([owner.id]);
    } finally {
      await sql.end({ timeout: 1 });
    }

    // The former member no longer sees it.
    const memberCtx = await signedIn(browser, member);
    const memberPage = await memberCtx.newPage();
    const res = await memberPage.goto(`${BASE_URL}/en/workspaces/${sharedId}`);
    expect(res?.status()).toBe(404);
    await memberCtx.close();
    await ctx.close();
  });

  test("Spanish variant — the confirmation steps", async ({ browser }, info) => {
    const { owner, member } = await resetUsers(info.project.name);
    const name = `Casa ${info.project.name}`;
    const sharedId = await seedShared(name, owner, member);

    const ctx = await signedIn(browser, owner);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/es/workspaces`);
    await expect(page.getByTestId("share-private-workspace")).toHaveText(/Compartir este espacio/);

    await page.goto(`${BASE_URL}/es/workspaces/${sharedId}`);
    await page.getByTestId("make-private-workspace").click();
    await expect(page.getByText("Paso 1 de 3")).toBeVisible();
    await expect(page.getByText("Tu espacio privado actual no tiene datos.")).toBeVisible();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByText("Dejarán de ver este espacio.")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    expect(await kindOf(sharedId)).toBe("shared");
    await ctx.close();
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function signedIn(browser: Browser, user: E2EUser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addCookies([await buildSessionCookie({ secret: AUTH_SECRET, userId: user.id, email: user.email })]);
  return ctx;
}

async function kindOf(workspaceId: string): Promise<string | undefined> {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ kind: string }[]>`SELECT kind FROM workspace WHERE id = ${workspaceId}`;
    return row?.kind;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedCategory(workspaceId: string, name: string): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    await sql`INSERT INTO category (workspace_id, kind, name) VALUES (${workspaceId}, 'expense', ${name})`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function seedShared(name: string, owner: E2EUser, member: E2EUser): Promise<string> {
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspace (kind, name, currency) VALUES ('shared', ${name}, 'EUR') RETURNING id`;
    await sql`INSERT INTO workspace_member (workspace_id, user_id, role)
              VALUES (${ws!.id}, ${owner.id}, 'owner'), (${ws!.id}, ${member.id}, 'editor')`;
    return ws!.id;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Wipes the project's fixed users and every workspace they touch, then re-seeds them. */
async function resetUsers(project: string): Promise<{ owner: E2EUser; member: E2EUser }> {
  const e = emails(project);
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      const users = await tx<{ id: string }[]>`SELECT id FROM app_user WHERE email IN (${e.owner}, ${e.member})`;
      const ids = users.map((u) => u.id);
      if (ids.length === 0) return;
      const ws = await tx<{ id: string }[]>`
        SELECT DISTINCT w.id FROM workspace w
        LEFT JOIN workspace_member m ON m.workspace_id = w.id
        WHERE w.personal_user_id IN ${tx(ids)} OR m.user_id IN ${tx(ids)}`;
      const wsIds = ws.map((w) => w.id);
      if (wsIds.length > 0) {
        await tx`DELETE FROM month_actual_expense WHERE month_id IN (SELECT id FROM month WHERE workspace_id IN ${tx(wsIds)})`;
        await tx`DELETE FROM month_fixed_line WHERE month_id IN (SELECT id FROM month WHERE workspace_id IN ${tx(wsIds)})`;
        await tx`DELETE FROM month_income WHERE month_id IN (SELECT id FROM month WHERE workspace_id IN ${tx(wsIds)})`;
        await tx`DELETE FROM month WHERE workspace_id IN ${tx(wsIds)}`;
        await tx`DELETE FROM template WHERE workspace_id IN ${tx(wsIds)}`;
        await tx`DELETE FROM annual WHERE workspace_id IN ${tx(wsIds)}`;
        await tx`DELETE FROM category WHERE workspace_id IN ${tx(wsIds)}`;
        await tx`DELETE FROM workspace WHERE id IN ${tx(wsIds)}`;
      }
      await tx`DELETE FROM app_user WHERE id IN ${tx(ids)}`;
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
  const owner = await ensureUser(DB_URL, AUTH_SECRET, { email: e.owner, googleSub: `${e.owner}-sub` });
  const member = await ensureUser(DB_URL, AUTH_SECRET, { email: e.member, googleSub: `${e.member}-sub` });
  const db = postgres(DB_URL, { max: 1, prepare: false });
  try {
    await db`UPDATE app_user SET display_name = 'Mara' WHERE id = ${member.id}`;
  } finally {
    await db.end({ timeout: 1 });
  }
  return { owner, member };
}
