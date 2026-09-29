import { defineConfig, devices } from "@playwright/test";
import { hashPassword } from "./src/lib/auth/session";

const PORT = 3100;

/**
 * The e2e server uses *hashed* credentials, not the plaintext env vars.
 *
 * The plaintext path is the easier one to wire up here, and using it left
 * the hashed path -- the one the README tells a real user to use -- with no
 * integration coverage. That gap hid a bug where a $-delimited hash was
 * silently mangled by dotenv (docs/AI_LOG.md #7). Generating the hashes here
 * means the suite exercises the path that actually ships.
 */
const ADMIN_PASSWORD = "admin-e2e-password";
const USER_PASSWORD = "user-e2e-password";

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
          ADMIN_PASSWORD_HASH: hashPassword(ADMIN_PASSWORD),
          USER_EMAIL: "user@madlan.test",
          USER_PASSWORD_HASH: hashPassword(USER_PASSWORD),
          // Deliberately absent: the e2e suite runs against a server with no
          // model, which is how constraint 6 ("survive the model being
          // unavailable") gets tested rather than asserted.
          ANTHROPIC_API_KEY: "",
          // Nothing sits in front of this server, so every browser-driven
          // request shares one rate-limit bucket. Real traffic does not: the
          // limiter keys on x-forwarded-for, which Vercel's edge sets per
          // client. Widened here so the suite tests the product rather than
          // the limiter, and budget.spec.ts claims its own client identity to
          // test the limiter directly.
          ASK_RATE_BURST: "40",
          ASK_RATE_PER_MINUTE: "600",
        },
      },
});
