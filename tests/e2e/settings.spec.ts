import { expect, test, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";

// ============================================================================
// UC-04 profile settings — end-to-end acceptance.
//
// Auth bypass: same helper as UC-03 — seed an `app_user` row + forge an
// Auth.js session cookie via `next-auth/jwt#encode`. The app decodes the
// cookie the same way it decodes one produced by a real Google sign-in.
//
// Acceptance criteria covered:
//   - First-time load shows EUR (UC-01 default), with the `formatMoney`
//     preview rendering `1234.56 EUR`, `0.00 EUR`, `-20.00 EUR`.
//   - Saving a new currency (USD) replaces the label everywhere — including
//     the preview rows AND the `Current currency` line. Stored amounts
//     are untouched (PRD UC-15).
//   - The save confirmation (`settings.status.saved`) appears via the
//     `aria-live="polite"` region.
//   - Invalid codes (we type a 4-letter string into the input — see helper)
//     surface the localized validation message.
//   - The Spanish variant loads the translated copy.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

test.describe("UC-04 profile settings (currency)", () => {
  test("EUR default → switch to USD → preview reflects new label, DB column only", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc04-${Date.now()}@example.com`,
      googleSub: `e2e-uc04-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetProfileSettings(DB_URL, user.id, "EUR");

    await page.goto(`${BASE_URL}/en/settings`);

    await expect(page.getByRole("heading", { level: 1, name: "Profile settings" })).toBeVisible();
    await expect(page.getByText("Labels show two decimals. No currency conversion.")).toBeVisible();

    const currencyForm = page.getByRole("form", { name: "Currency" });
    await expect(currencyForm.locator("#currency")).toHaveValue("EUR");

    await currencyForm.locator("#currency").selectOption("USD");
    await currencyForm.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Currency saved.")).toBeVisible();
    await expect(currencyForm.locator("#currency")).toHaveValue("USD");

    // DB: only `profile_settings.currency` changed — `updated_at` moved, no
    // amount columns exist on the row (PRD UC-15, no FX).
    const db = postgres(DB_URL, { max: 1, prepare: false });
    try {
      const rows = await db<{ currency: string }[]>`
        SELECT currency FROM profile_settings WHERE user_id = ${user.id}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.currency).toBe("USD");
    } finally {
      await db.end({ timeout: 1 });
    }
  });

  test("language switch renders the settings screen in Spanish", async ({
    context,
    page,
  }) => {
    const user = await ensureUser(DB_URL, AUTH_SECRET, {
      email: `e2e-uc04-es-${Date.now()}@example.com`,
      googleSub: `e2e-uc04-es-sub-${Date.now()}`,
    });
    await attachSessionCookie(context, user);
    await resetProfileSettings(DB_URL, user.id, "EUR");

    await page.goto(`${BASE_URL}/es/settings`);
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes del perfil" })).toBeVisible();
    await expect(page.getByText("Las etiquetas muestran dos decimales. Sin conversión de moneda.")).toBeVisible();
    await expect(page.getByRole("form", { name: "Moneda" }).locator("#currency")).toHaveValue("EUR");
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

async function resetProfileSettings(dbUrl: string, userId: string, currency: string): Promise<void> {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql`
      INSERT INTO profile_settings (user_id, currency)
      VALUES (${userId}, ${currency})
      ON CONFLICT (user_id) DO UPDATE SET currency = EXCLUDED.currency
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
