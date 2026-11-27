import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { buildSessionCookie, ensureUser } from "./_helpers/auth";
import { uniqueId } from "./_helpers/unique";

// ============================================================================
// iPhone app shell — mobile top bar and safe areas.
//
// On iPhone the app draws edge to edge (viewport-fit=cover) under a
// translucent status bar. The profile button used to sit in the top 24px of
// the page, behind the clock / Dynamic Island, where iOS swallows taps.
//
//   - mobile-safari: the navy top bar holds the profile button; it opens the
//     menu and a tap on a non-interactive area closes it again (iOS sends no
//     mouse events there, so the old `mousedown` listener never fired).
//   - chromium: no top bar on desktop; the inline profile button stays.
//   - chromium + iPhone insets (CDP Emulation.setSafeAreaInsetsOverride):
//     nothing interactive sits under the status bar or the home indicator.
//   - chromium + Android phone: a real finger swipe (CDP touch scroll gesture)
//     scrolls the page, and the mouse wheel does on desktop. v0.17.2 put
//     `overscroll-behavior-y: none` on <body>, which (body being a
//     non-scrolling scroll container because of overflow-x: hidden) stopped
//     touch scrolls from chaining to the page on Android.
// ============================================================================

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "75221854ca655e59e773f4082ae8fc4ed28309b9f1b409d90b8edbae53df65bf";
const DB_URL =
  process.env.PLAYWRIGHT_TEST_DATABASE_URL ??
  "postgres://expenses:devpassword@localhost:5432/expenses";

// iPhone 15/16 Pro portrait safe areas in standalone mode (points).
const IPHONE_INSETS = { top: 59, bottom: 34, left: 0, right: 0 };

async function seedSignedIn(context: BrowserContext): Promise<void> {
  const id = uniqueId();
  const user = await ensureUser(DB_URL, AUTH_SECRET, {
    email: `e2e-shell-${id}@example.com`,
    googleSub: `e2e-shell-sub-${id}`,
  });
  const cookie = await buildSessionCookie({
    secret: AUTH_SECRET,
    userId: user.id,
    email: user.email,
  });
  await context.addCookies([cookie]);
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} has no bounding box`);
  return b;
}

test.describe("iPhone app shell", () => {
  test("mobile top bar opens the profile menu; tapping outside closes it", async ({
    context,
    page,
  }, testInfo) => {
    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en`);

    if (testInfo.project.name !== "mobile-safari") {
      await expect(page.getByTestId("mobile-top-bar")).toBeHidden();
      await expect(page.getByRole("button", { name: /e2e-shell-/ })).toBeVisible();
      return;
    }

    const bar = page.getByTestId("mobile-top-bar");
    await expect(bar).toBeVisible();
    const trigger = bar.getByRole("button", { name: "Account menu" });
    await expect(trigger).toBeVisible();

    // 44pt minimum touch target (Apple HIG).
    const t = await box(page, "profile-menu-trigger");
    expect(t.width).toBeGreaterThanOrEqual(44);
    expect(t.height).toBeGreaterThanOrEqual(44);

    await trigger.tap();
    const menu = page.getByTestId("profile-menu");
    await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();

    // Tap a plain heading — no click handler, no cursor:pointer.
    await page.getByRole("heading", { level: 1 }).tap();
    await expect(menu).toBeHidden();
  });

  test("with iPhone safe areas nothing sits under the status bar or home indicator", async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "safe-area override is a Chromium CDP feature");

    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    });
    await seedSignedIn(context);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, {
        insets: IPHONE_INSETS,
      } as never);
    } catch {
      test.skip(true, "this Chromium has no Emulation.setSafeAreaInsetsOverride");
    }
    await page.goto(`${BASE_URL}/en`);

    const bar = await box(page, "mobile-top-bar");
    const trigger = await box(page, "profile-menu-trigger");
    const nav = await box(page, "mobile-nav");

    // The bar covers the status bar area; the button starts below it.
    expect(bar.y).toBe(0);
    expect(trigger.y).toBeGreaterThanOrEqual(IPHONE_INSETS.top);

    // The button is what receives a tap at its centre (nothing on top).
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid"),
      [trigger.x + trigger.width / 2, trigger.y + trigger.height / 2],
    );
    expect(hit).toBe("profile-menu-trigger");

    // Bottom nav: flush with the screen bottom, items above the home indicator.
    expect(Math.round(nav.y + nav.height)).toBe(852);
    const navPadBottom = await page
      .getByTestId("mobile-nav")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(navPadBottom).toBe(IPHONE_INSETS.bottom);

    // Page content reserves room for the whole nav, so the last row can
    // scroll clear of it.
    const mainPadBottom = await page
      .locator("main")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(mainPadBottom).toBeGreaterThanOrEqual(nav.height);

    // Content starts below the top bar.
    const mainPadTop = await page
      .locator("main")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(mainPadTop).toBeCloseTo(bar.height, 0);

    await page.screenshot({ path: test.info().outputPath("iphone-safe-areas.png") });
    await context.close();
  });

  test("a finger swipe scrolls the page on an Android phone", async ({ browser, browserName }) => {
    test.skip(browserName !== "chromium", "touch scroll gestures are a Chromium CDP feature");

    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
    const context = await browser.newContext({
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
    });
    await seedSignedIn(context);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/en`);
    await makePageTall(page);

    const cdp = await context.newCDPSession(page);
    const { width, height } = page.viewportSize()!;
    // Start the swipe on page content between the top bar and bottom nav:
    // once on the "Create a month" card, once on plain page space.
    for (const startY of [0.35, 0.6]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(width / 2),
        y: Math.round(height * startY),
        yDistance: -600, // negative = finger moves up = page scrolls down
        gestureSourceType: "touch",
        speed: 1200,
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    }
    await context.close();
  });

  test("the mouse wheel scrolls the page on desktop", async ({ context, page, browserName }) => {
    test.skip(browserName !== "chromium", "desktop project only");

    await seedSignedIn(context);
    await page.goto(`${BASE_URL}/en`);
    await makePageTall(page);
    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 800);

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  });
});

// Home has little content for a fresh user; add a tall block inside the page
// column so there is something to scroll, without changing the scroll chain.
async function makePageTall(page: Page): Promise<void> {
  await page.locator("main > div").evaluate((el) => {
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    spacer.dataset.testid = "scroll-spacer";
    el.appendChild(spacer);
  });
  await expect(page.getByTestId("scroll-spacer")).toBeAttached();
}
