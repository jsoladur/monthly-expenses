import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser, type E2EUser } from "./_helpers/auth";

// ============================================================================
// UC-32 ownership transfer — end-to-end (PRD UC-34, §15 scenarios 94, 95,
// 101 through the UI + Spanish variant).
//
// Offering and accepting re-check `ALLOWED_EMAILS` on the server (UC-32 §2
// rule 3), so this spec uses FIXED addresses that the server under test must
// allowlist. Run the server with them added, e.g.
//
//   ALLOWED_EMAILS="$ALLOWED_EMAILS,$(node -e 'console.log(require("./tests/e2e/workspace-transfer.spec.emails.json").join(","))')"
//
// The spec runs only with UC32_E2E=1 (set it once the server allowlists them).
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

// One pair of users per browser project, so the projects never share state.
function emails(project: string) {
  return {
    owner: `e2e-uc32-owner-${project}@example.com`,
    target: `e2e-uc32-target-${project}@example.com`,
  };
}

test.describe("UC-32 ownership transfer", () => {
  // The tests of one browser project share its fixed pair of users, so they
  // must not run at the same time (each one resets the pair first).
  test.describe.configure({ mode: "serial" });
  test.skip(
    process.env.UC32_E2E !== "1",
    "Set UC32_E2E=1 and allowlist tests/e2e/workspace-transfer.spec.emails.json on the server",
  );

  test("94/95/101 — the Owner offers, the member accepts, the former Owner becomes an Admin", async ({
    browser,
  }, info) => {
    const { owner, target, workspaceId, name } = await seedPair(info.project.name, "Home budget");

    // --- Owner offers -------------------------------------------------------
    const ownerCtx = await signedIn(browser, owner);
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(`${BASE_URL}/en/workspaces/${workspaceId}`);
    await ownerPage.getByTestId("transfer-ownership").click();
    await ownerPage.getByLabel("New owner").selectOption(target.id);
    await expect(
      ownerPage.getByText("After they accept, you become an Admin of this workspace."),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: "Offer ownership" }).click();
    await expect(ownerPage.getByText("Offered to Tomás. Waiting for their answer.")).toBeVisible();
    await expect(ownerPage.getByTestId("transfer-ownership")).toHaveCount(0);

    // --- Recipient sees it and accepts ---------------------------------------
    const targetCtx = await signedIn(browser, target);
    const targetPage = await targetCtx.newPage();
    await targetPage.goto(`${BASE_URL}/en/workspaces`);
    await expect(targetPage.locator("main").getByText("Ownership offered to you")).toBeVisible();
    await targetPage.goto(`${BASE_URL}/en/workspaces/${workspaceId}`);
    await expect(targetPage.getByText(`Olga offers you ownership of ${name}.`)).toBeVisible();
    await targetPage.getByRole("button", { name: "Accept ownership" }).click();
    await expect(
      targetPage.getByText("You become the Owner. Olga becomes an Admin."),
    ).toBeVisible();
    await targetPage.getByRole("button", { name: "Yes, become the Owner" }).click();
    await expect(targetPage.getByText(`You are now the Owner of ${name}.`)).toBeVisible();
    await expect(targetPage.getByTestId("transfer-ownership")).toBeVisible();

    // --- Former Owner now has the Admin view ---------------------------------
    await ownerPage.reload();
    await expect(ownerPage.getByTestId("transfer-ownership")).toHaveCount(0);
    await expect(ownerPage.getByText("Delete workspace…")).toHaveCount(0);
    await expect(ownerPage.getByRole("button", { name: "Leave workspace" })).toBeVisible();

    await ownerCtx.close();
    await targetCtx.close();
  });

  test("decline and cancel leave the Owner in place", async ({ browser }, info) => {
    const { owner, target, workspaceId } = await seedPair(info.project.name, "Trip");
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      await sql`INSERT INTO workspace_transfer (workspace_id, from_user_id, to_user_id)
                VALUES (${workspaceId}, ${owner.id}, ${target.id})`;
    } finally {
      await sql.end({ timeout: 1 });
    }
    const targetCtx = await signedIn(browser, target);
    const page = await targetCtx.newPage();
    await page.goto(`${BASE_URL}/en/workspaces/${workspaceId}`);
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText(/offers you ownership/)).toHaveCount(0);
    await expect(page.getByTestId("transfer-ownership")).toHaveCount(0);
    await targetCtx.close();

    const ownerCtx = await signedIn(browser, owner);
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto(`${BASE_URL}/en/workspaces/${workspaceId}`);
    await expect(ownerPage.getByTestId("transfer-ownership")).toBeVisible();
    await ownerCtx.close();
  });

  test("Spanish variant — the recipient banner", async ({ browser }, info) => {
    const { owner, target, workspaceId, name } = await seedPair(info.project.name, "Casa");
    const sql = postgres(DB_URL, { max: 1, prepare: false });
    try {
      await sql`INSERT INTO workspace_transfer (workspace_id, from_user_id, to_user_id)
                VALUES (${workspaceId}, ${owner.id}, ${target.id})`;
    } finally {
      await sql.end({ timeout: 1 });
    }
    const ctx = await signedIn(browser, target);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/es/workspaces/${workspaceId}`);
    await expect(page.getByText(`Olga te ofrece ser propietario de ${name}.`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Aceptar la propiedad" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rechazar" })).toBeVisible();
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

/**
 * Fresh owner ("Olga") + editor ("Tomás") sharing a workspace. The fixed users
 * are wiped first (children first: `month_actual_expense.category_id` is
 * ON DELETE RESTRICT), so each test starts clean.
 */
async function seedPair(project: string, baseName: string) {
  const e = emails(project);
  const name = `${baseName} ${project}`;
  const sql = postgres(DB_URL, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      const users = await tx<{ id: string }[]>`SELECT id FROM app_user WHERE email IN (${e.owner}, ${e.target})`;
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
  const target = await ensureUser(DB_URL, AUTH_SECRET, { email: e.target, googleSub: `${e.target}-sub` });
  const db = postgres(DB_URL, { max: 1, prepare: false });
  let workspaceId: string;
  try {
    await db`UPDATE app_user SET display_name = 'Olga' WHERE id = ${owner.id}`;
    await db`UPDATE app_user SET display_name = 'Tomás' WHERE id = ${target.id}`;
    const [ws] = await db<{ id: string }[]>`
      INSERT INTO workspace (kind, name, currency) VALUES ('shared', ${name}, 'EUR') RETURNING id`;
    workspaceId = ws!.id;
    await db`INSERT INTO workspace_member (workspace_id, user_id, role)
             VALUES (${workspaceId}, ${owner.id}, 'owner'), (${workspaceId}, ${target.id}, 'editor')`;
  } finally {
    await db.end({ timeout: 1 });
  }
  return { owner, target, workspaceId, name };
}
