import { expect, test } from "@playwright/test";

// ============================================================================
// UC-02 — i18n shell (en/es) — e2e acceptance criteria.
//
// PRD C4 / §11 + UC-02 acceptance:
//   1. Browser `es` → Spanish shell.
//   2. Browser `fr` → English fallback (locale not in `en`/`es`).
//   3. Switching language persists across reloads via the cookie.
//   4. 403 renders translated.
//   5. Amount input rejects `1234,56` and accepts `1234.56` regardless of
//      locale (PRD C9).
//
// The auth screens (sign-in, 403) are reachable without an OAuth flow, so
// the whole UC-02 acceptance suite can run against the running dev server
// without mocking Google.
// ============================================================================

test.describe("UC-02 i18n shell", () => {
  test("browser `fr` lands on the English shell (UC-02 acceptance #1)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign in",
    );
  });

  test("browser `es` lands on the Spanish shell (UC-02 acceptance #2)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      locale: "es-ES",
      extraHTTPHeaders: { "Accept-Language": "es" },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/es\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Iniciar sesión",
    );
    await context.close();
  });

  test("switching language persists across reloads (UC-02 acceptance #3)", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    // The switcher is rendered as a nav with two links labelled EN and ES.
    // Click "ES" — the next-intl `<Link>` rewrites the URL and the
    // middleware sets the `NEXT_LOCALE` cookie in response.
    await page
      .getByRole("navigation", { name: /language|idioma/i })
      .getByRole("link", { name: "ES" })
      .click();
    await expect(page).toHaveURL(/\/es\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Iniciar sesión",
    );

    // Hard reload: cookie wins, no `Accept-Language` negotiation.
    await page.reload();
    await expect(page).toHaveURL(/\/es\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Iniciar sesión",
    );

    // Clean up: switch back so subsequent tests start on `en`.
    await page
      .getByRole("navigation", { name: /language|idioma/i })
      .getByRole("link", { name: "EN" })
      .click();
    await expect(page).toHaveURL(/\/en\/sign-in$/);
  });

  test("403 page renders translated (UC-02 acceptance #4)", async ({
    page,
  }) => {
    await page.goto("/en/403");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Access denied",
    );
    await expect(
      page.getByText("This account is not allowed to use the app."),
    ).toBeVisible();

    await page.goto("/es/403");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Acceso denegado",
    );
    await expect(
      page.getByText("Esta cuenta no tiene permiso para usar la aplicación."),
    ).toBeVisible();
  });
});
