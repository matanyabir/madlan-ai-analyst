import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    locale: "he-IL",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run start -- --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          AUTH_SECRET: "e2e-test-secret-not-for-production-use-0123456789",
          ADMIN_EMAIL: "admin@madlan.test",
          ADMIN_PASSWORD: "admin-e2e-password",
          USER_EMAIL: "user@madlan.test",
          USER_PASSWORD: "user-e2e-password",
          // Deliberately absent: the e2e suite runs against a server with no
          // model, which is how constraint 6 ("survive the model being
          // unavailable") gets tested rather than asserted.
          ANTHROPIC_API_KEY: "",
        },
      },
});
