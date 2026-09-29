import { test, expect } from "@playwright/test";

/**
 * The login form must never leak credentials into a URL.
 *
 * A <form> with no action/method submits as a GET to the current URL, which
 * serialises every field into the query string. That is the browser default
 * whenever hydration has not completed, so it is not a hypothetical.
 */
test.describe("login", () => {
  test("signs in and lands on the admin page", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("admin-e2e-password");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "ניהול נתונים" })).toBeVisible();
    expect(page.url()).not.toContain("password");
  });

  test("lands on /admin when redirected there first, not back on login", async ({ page }) => {
    /*
     * The real user flow, and the one a fresh-context test misses: visit
     * /admin, get bounced to /login?next=/admin, then sign in. That first
     * bounce puts a logged-out /admin in Next's client router cache, so a
     * soft navigation after login could be served from it — landing the user
     * back on /login looking like the sign-in silently failed.
     */
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("admin-e2e-password");
    await page.getByTestId("login-submit").click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "ניהול נתונים" })).toBeVisible();
    await expect(page.getByTestId("login-form")).toHaveCount(0);
  });

  test("signing out actually signs out, with no cached admin page left", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("admin-e2e-password");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByTestId("logout").click();
    await expect(page).toHaveURL(/:\d+\/$/);

    // The cached admin page must not survive the session that produced it.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends a regular user to the analyst, not the admin page", async ({ page }) => {
    await page.goto("/login?next=%2Fadmin");
    await page.getByTestId("email").fill("user@madlan.test");
    await page.getByTestId("password").fill("user-e2e-password");
    await page.getByTestId("login-submit").click();

    // ?next=/admin must not grant a non-admin access to /admin.
    await expect(page).toHaveURL(/:\d+\/$/);
  });

  test("never puts the password in the URL, even with JavaScript disabled", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("admin-e2e-password");
    await page.getByTestId("login-submit").click();
    await page.waitForLoadState();

    // The decisive assertion: credentials nowhere in the address bar.
    expect(page.url()).not.toContain("password");
    expect(page.url()).not.toContain("admin-e2e-password");
    expect(page.url()).not.toContain("email=");

    // And the no-JS submit is a real login, not merely a non-leaky failure.
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "ניהול נתונים" })).toBeVisible();

    await context.close();
  });

  test("shows an error without JavaScript when the password is wrong", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("wrong");
    await page.getByTestId("login-submit").click();
    await page.waitForLoadState();

    expect(page.url()).not.toContain("wrong");
    await expect(page.getByTestId("login-error")).toBeVisible();

    await context.close();
  });

  test("rejects an off-site redirect target", async ({ page }) => {
    await page.goto("/login?next=https%3A%2F%2Fevil.example.com");
    await page.getByTestId("email").fill("admin@madlan.test");
    await page.getByTestId("password").fill("admin-e2e-password");
    await page.getByTestId("login-submit").click();

    // Wait for the navigation to actually land before inspecting the URL.
    await expect(page).toHaveURL(/\/admin$/);
    expect(page.url()).not.toContain("evil.example.com");
  });
});
