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
