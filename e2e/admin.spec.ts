import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const CSV = resolve("data/madlan_deals_sample.csv");

const ADMIN = { email: "admin@madlan.test", password: "admin-e2e-password" };
const USER = { email: "user@madlan.test", password: "user-e2e-password" };

/**
 * Logs in and waits for the whole flow to settle.
 *
 * Two waits, for two different races:
 *   - the response, because returning before Set-Cookie lands looks exactly
 *     like a broken guard;
 *   - the navigation away from /login, because a successful sign-in does a
 *     full page load, and acting during it destroys the execution context.
 */
async function login(
  page: import("@playwright/test").Page,
  who: typeof ADMIN,
): Promise<number> {
  await page.goto("/login");
  await page.getByTestId("email").fill(who.email);
  await page.getByTestId("password").fill(who.password);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login")),
    page.getByTestId("login-submit").click(),
  ]);

  if (response.ok()) {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
    await page.waitForLoadState("load");
  }
  return response.status();
}

test.describe("access control", () => {
  test("an anonymous visitor is sent to login, with a return path", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
    await expect(page.getByTestId("login-form")).toBeVisible();
  });

  test("the admin API refuses an anonymous request", async ({ request }) => {
    expect((await request.post("/api/admin/upload")).status()).toBe(401);
    expect((await request.get("/api/admin/snapshot")).status()).toBe(401);
  });

  test("a wrong password is rejected without revealing which part was wrong", async ({ page }) => {
    await login(page, { email: ADMIN.email, password: "definitely-wrong" });
    await expect(page.getByTestId("login-error")).toContainText("אימייל או סיסמה שגויים");

    await login(page, { email: "nobody@madlan.test", password: ADMIN.password });
    await expect(page.getByTestId("login-error")).toContainText("אימייל או סיסמה שגויים");
  });

  test("a regular user cannot reach the admin area", async ({ page }) => {
    expect(await login(page, USER)).toBe(200);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\?denied=admin/);
    await expect(page.getByTestId("file-input")).toHaveCount(0);
  });

  test("a regular user is refused by the admin API, not just the page", async ({ page }) => {
    expect(await login(page, USER)).toBe(200);

    // Issued from inside the page rather than via page.request: the session
    // cookie is Secure (correct in production), and browsers make a
    // localhost exception for Secure cookies that Playwright's
    // APIRequestContext does not. Going through the browser exercises the
    // real cookie semantics instead of weakening the cookie for a test.
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/admin/upload", { method: "POST" });
      return r.status;
    });

    // The page redirect is UX; this is the boundary that matters.
    expect(status).toBe(403);
  });
});

test.describe("the AI kill switch", () => {
  test.beforeEach(async ({ page }) => {
    expect(await login(page, ADMIN)).toBe(200);
  });

  test("explains itself when no key is configured", async ({ page }) => {
    // The e2e server runs without ANTHROPIC_API_KEY, so the panel must say
    // that rather than offer a switch that could not do anything.
    const panel = page.getByTestId("ai-toggle");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("לא הוגדר מפתח API");
    await expect(panel).toContainText("כל המספרים מדויקים");
    await expect(page.getByTestId("ai-toggle-button")).toHaveCount(0);
  });

  test("the switch API is admin-only", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    expect(await login(page, USER)).toBe(200);

    const status = await page.evaluate(async () => {
      const r = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      return r.status;
    });
    expect(status).toBe(403);
    await context.close();
  });

  test("rejects a malformed value", async ({ page }) => {
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: "yes please" }),
      });
      return r.status;
    });
    expect(status).toBe(400);
  });

  test("the preference survives navigating away and back", async ({ page }) => {
    /*
     * The reported bug: turn it off, navigate away, come back, it is on
     * again. A server-side flag cannot work — globalThis is per serverless
     * instance, so the next request may land somewhere that never saw the
     * write. The preference rides on a cookie instead.
     */
    await page.evaluate(async () => {
      await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("ai-status-badge")).toHaveAttribute("data-enabled", "false");

    await page.goto("/admin");
    await page.goto("/");
    await page.goto("/admin");
    // Still off after bouncing between pages.
    const state = await page.evaluate(async () => {
      const r = await fetch("/api/admin/ai");
      return (await r.json()).enabled;
    });
    expect(state).toBe(false);
  });

  test("turning it back on clears the preference", async ({ page }) => {
    const set = async (enabled: boolean) =>
      page.evaluate(async (v) => {
        const r = await fetch("/api/admin/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: v }),
        });
        return (await r.json()).enabled;
      }, enabled);

    expect(await set(false)).toBe(false);
    expect(await set(true)).toBe(true);

    await page.goto("/");
    // No key on the e2e server, so the badge is off either way -- what
    // matters is that the stored preference is gone.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "madlan_ai")?.value ?? "").not.toBe("off");
  });

  test("turning it off still answers every question", async ({ page }) => {
    // The switch is the demo: with the model off, the product keeps working.
    await page.evaluate(async () => {
      await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    });

    await page.goto("/");
    await page.getByTestId("question-input").fill("תשווה בין רמת גן לגבעתיים");
    await page.getByTestId("submit").click();

    await expect(page.getByTestId("comparison")).toBeVisible();
    await expect(page.getByTestId("degraded-badge")).toBeVisible();
    await expect(page.getByTestId("evidence-count")).not.toHaveText("0");
  });
});

test.describe("the admin upload", () => {
  test.beforeEach(async ({ page }) => {
    // login() already lands on /admin; no second navigation needed.
    expect(await login(page, ADMIN)).toBe(200);
    await expect(page.getByRole("heading", { name: "ניהול נתונים" })).toBeVisible();
  });

  test("processes the CSV and reports what it found", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);

    const result = page.getByTestId("upload-result");
    await expect(result).toBeVisible({ timeout: 30_000 });

    // The headline counts from docs/DATA_QUALITY.md.
    await expect(result).toContainText("530");
    await expect(result).toContainText("505");
  });

  test("distinguishes merged duplicates from conflicting ones", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    const log = page.getByTestId("issue-log");

    // 6 identical pairs were merged.
    await log.getByLabel("סוג").selectOption("duplicate_identical");
    await expect(log.locator("tbody tr")).toHaveCount(6);

    // 4 conflicting pairs -- 8 rows -- were kept, not merged.
    await log.getByLabel("סוג").selectOption("duplicate_conflict");
    await expect(log.locator("tbody tr")).toHaveCount(8);
    await expect(log).toContainText("שתי הגרסאות נשמרו");
  });

  test("shows the 28 price-per-sqm conflicts", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    const log = page.getByTestId("issue-log");
    await log.getByLabel("סוג").selectOption("price_per_sqm_conflict");
    await expect(log.locator("tbody tr")).toHaveCount(28);
  });

  test("reports the shekel-sign prices it recovered", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    const log = page.getByTestId("issue-log");
    await log.getByLabel("סוג").selectOption("price_currency_symbol_stripped");
    await expect(log.locator("tbody tr")).toHaveCount(12);
  });

  test("filters the log by severity", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    const log = page.getByTestId("issue-log");
    await log.getByLabel("חומרה").selectOption("error");
    await expect(log.locator("tbody tr")).toHaveCount(10);
  });

  test("says the AI step was not needed on a clean file", async ({ page }) => {
    // All 530 rows resolve deterministically, so the upload costs nothing.
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("לא נדרשה התערבות של AI")).toBeVisible();
  });

  test("the home page reflects an upload immediately", async ({ page }) => {
    /*
     * Regression: Server Components and Route Handlers are separate module
     * graphs, so the upload replaced the snapshot for the API while the home
     * page kept rendering the committed one — advertising 505 deals while
     * questions used a different dataset.
     */
    await page.getByTestId("file-input").setInputFiles({
      name: "small.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "deal_id,city,neighborhood,street,property_type,rooms,size_sqm,floor,total_floors,year_built,condition,has_elevator,has_parking,has_balcony,has_safe_room,deal_date,price_nis,price_per_sqm,source",
          "D1,רמת גן,מרכז,ביאליק,דירה,4,100,2,8,2000,שמור,כן,כן,כן,כן,2025-01-01,3000000,30000,מתווך",
          "D2,רמת גן,מרכז,ביאליק,דירה,3,80,1,8,2000,שמור,כן,כן,כן,כן,2025-02-01,2400000,30000,מתווך",
        ].join("\n"),
      ),
    });
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    await page.goto("/");
    const header = page.locator("header");
    await expect(header).toContainText("2");
    await expect(header).not.toContainText("505");
  });

  test("is honest that the upload does not persist", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles(CSV);
    await expect(page.getByTestId("upload-result")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("אין בגרסה זו בסיס נתונים")).toBeVisible();
    await expect(page.getByTestId("download-snapshot")).toBeVisible();
  });

  test("rejects a file that is not this dataset", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles({
      name: "wrong.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,age\nalice,30\n"),
    });
    await expect(page.getByTestId("upload-error")).toContainText("חסרות עמודות חובה");
  });

  test("rejects an empty file", async ({ page }) => {
    await page.getByTestId("file-input").setInputFiles({
      name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from(""),
    });
    await expect(page.getByTestId("upload-error")).toBeVisible();
  });

  test("logging out closes the admin area", async ({ page }) => {
    await page.getByTestId("logout").click();
    await expect(page).toHaveURL("/");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});
