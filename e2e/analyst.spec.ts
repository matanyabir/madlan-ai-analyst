import { test, expect } from "@playwright/test";

/**
 * The five demo flows from the brief, plus the grounding and failure
 * behaviour, driven through the real UI against a production build.
 *
 * The test server runs without ANTHROPIC_API_KEY (see playwright.config.ts),
 * so these also prove the whole product works with the model unavailable —
 * which is constraint 6 of the brief, tested rather than asserted.
 */

test.describe("the analyst page", () => {
  test.beforeEach(async ({ page }) => await page.goto("/"));

  test("is Hebrew and right-to-left", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByRole("heading", { name: "אנליסט הנדל״ן" })).toBeVisible();
  });

  test("shows the real dataset size in the header, not marketing copy", async ({ page }) => {
    await expect(page.getByText("505", { exact: false }).first()).toBeVisible();
  });

  test("offers the example prompts before anything is asked", async ({ page }) => {
    await expect(page.getByTestId("example-prompt")).toHaveCount(5);
  });

  test("Demo 1 — a trend question renders a chart with evidence", async ({ page }) => {
    await page.getByTestId("question-input").fill('איך השתנה המחיר למ״ר ברמת גן?');
    await page.getByTestId("submit").click();

    const answer = page.getByTestId("answer");
    await expect(answer).toBeVisible();
    await expect(page.getByTestId("time-series")).toBeVisible();
    await expect(answer.locator("svg.recharts-surface")).toBeVisible();

    // Grounding is visible, with a real transaction count.
    const count = await page.getByTestId("evidence-count").textContent();
    expect(Number(count!.replace(/\D/g, ""))).toBeGreaterThan(10);
    await expect(page.getByTestId("evidence")).toContainText("טווח תאריכים");
  });

  test("Demo 2 — a comparison renders both cities with their sample sizes", async ({ page }) => {
    await page.getByTestId("question-input").fill("תשווה בין רמת גן לגבעתיים");
    await page.getByTestId("submit").click();

    await expect(page.getByTestId("comparison")).toBeVisible();
    await expect(page.getByTestId("comparison")).toContainText("רמת גן");
    await expect(page.getByTestId("comparison")).toContainText("גבעתיים");
    await expect(page.getByTestId("comparison")).toContainText("עסקאות");
  });

  test("Demo 3 — comparable deals explain why each was selected", async ({ page }) => {
    await page.getByTestId("question-input")
      .fill('מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ״ר ברמת גן');
    await page.getByTestId("submit").click();

    const list = page.getByTestId("deal-list");
    await expect(list).toBeVisible();
    await expect(list.locator("li")).not.toHaveCount(0);

    // The similarity breakdown is reachable, not just a score.
    await page.getByRole("button", { name: "למה?" }).first().click();
    await expect(page.getByText("מספר חדרים").first()).toBeVisible();
  });

  test("Demo 4 — an unsupported question is declined without figures", async ({ page }) => {
    await page.getByTestId("question-input").fill("איזו שכונה הכי שקטה ומתאימה למשפחות?");
    await page.getByTestId("submit").click();

    await expect(page.getByTestId("text-answer")).toBeVisible();
    await expect(page.getByTestId("answer-title")).toContainText("לא מכיל");

    // The decisive assertion: no invented number anywhere in the answer.
    const summary = await page.getByTestId("summary").textContent();
    expect(summary).not.toMatch(/\d{3,}/);
    await expect(page.getByTestId("evidence-count")).toHaveText("0");
  });

  test("Demo 5 — a factual question leads with the metric", async ({ page }) => {
    await page.getByTestId("question-input").fill("כמה עסקאות של 4 חדרים יש בחיפה?");
    await page.getByTestId("submit").click();

    await expect(page.getByTestId("statistics")).toBeVisible();
    await expect(page.getByTestId("headline-metric")).toBeVisible();
  });

  test("a forecast question is refused", async ({ page }) => {
    await page.getByTestId("question-input").fill("מה יהיה מחיר הדירות ברמת גן ב-2030?");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("answer-title")).toContainText("לא מכיל");
  });

  test("an answer on few transactions says so", async ({ page }) => {
    await page.getByTestId("question-input").fill("כמה עסקאות של 4 חדרים יש ברמת גן?");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("evidence")).toContainText("מדגם קטן");
  });

  test("clicking an example prompt runs it", async ({ page }) => {
    await page.getByTestId("example-prompt").first().click();
    await expect(page.getByTestId("answer")).toBeVisible();
  });

  test("says plainly when the model was not involved", async ({ page }) => {
    // The e2e server has no API key, so every answer is degraded. The badge
    // must distinguish "the prose is templated" from "the data is suspect".
    await page.getByTestId("question-input").fill("כמה עסקאות יש בחולון?");
    await page.getByTestId("submit").click();

    const badge = page.getByTestId("degraded-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("הנתונים מדויקים");
  });

  test("rejects an over-long question rather than truncating it", async ({ page }) => {
    const res = await page.request.post("/api/ask", {
      data: { question: "א".repeat(500) },
    });
    expect(res.status()).toBe(400);
  });

  test("no raw JSON is ever shown to the user", async ({ page }) => {
    await page.getByTestId("question-input").fill("מצא עסקאות חריגות");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("answer")).toBeVisible();

    const body = await page.locator("body").textContent();
    expect(body).not.toMatch(/\{"type":|"evidence":|snapshotVersion/);
  });

  test("anomalies are described as unusual, never as wrong", async ({ page }) => {
    await page.getByTestId("question-input").fill("מצא עסקאות חריגות");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("answer")).toBeVisible();

    await expect(page.getByText("חריגה סטטיסטית").first()).toBeVisible();
    const body = await page.locator("body").textContent();
    expect(body).not.toMatch(/מחיר שגוי|נתון שגוי|טעות בנתונים/);
  });
});

test.describe("responsive", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("works on a phone without horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("question-input").fill("תשווה בין רמת גן לגבעתיים");
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("answer")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("the no-model browse page", () => {
  test("filters transactions with no JavaScript needed", async ({ page }) => {
    await page.goto("/browse?city=%D7%97%D7%99%D7%A4%D7%94");
    await expect(page.getByTestId("deal-list")).toBeVisible();

    const cards = page.getByTestId("deal-list").locator("li");
    await expect(cards.first()).toContainText("חיפה");
    await expect(page.getByTestId("evidence")).toBeVisible();
  });

  test("ignores a filter value that is not in the data", async ({ page }) => {
    await page.goto("/browse?city=Atlantis");
    // Falls back to unfiltered rather than erroring or showing nothing.
    await expect(page.getByTestId("deal-list")).toBeVisible();
  });
});

test("health endpoint reports the live snapshot", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.snapshot.analyzable).toBe(505);
  expect(body.snapshot.rawRows).toBe(530);
});
