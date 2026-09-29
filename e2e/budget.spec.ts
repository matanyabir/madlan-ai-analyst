import { test, expect } from "@playwright/test";

/**
 * The spend guards, at the HTTP layer.
 *
 * `/api/ask` is public, so the unit tests in lib/llm/budget.test.ts are only
 * half the story — they prove the limiter's arithmetic, not that it is wired
 * in front of the endpoint. This proves the wiring.
 *
 * Each test claims its own `x-forwarded-for`, which is how the limiter
 * identifies a caller. That keeps these from spending the bucket the
 * browser-driven tests share, and mirrors what Vercel's edge sets in
 * production.
 */

const QUESTION = "כמה עסקאות יש ברמת גן?";

function ask(request: import("@playwright/test").APIRequestContext, ip: string) {
  return request.post("/api/ask", {
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    data: { question: QUESTION },
    failOnStatusCode: false,
  });
}

test.describe("spend guards", () => {
  test("answers a normal question without interference", async ({ request }) => {
    const res = await ask(request, "203.0.113.10");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.result.type).toBe("statistics");
  });

  test("turns away a caller in a loop, and says when to come back", async ({ request }) => {
    const ip = "203.0.113.11";
    // Fired together so the bucket cannot meaningfully refill in between.
    const responses = await Promise.all(
      Array.from({ length: 80 }, () => ask(request, ip)),
    );
    const statuses = responses.map((r) => r.status());

    expect(statuses).toContain(429);
    // Refused, not broken: the early ones were answered normally.
    expect(statuses).toContain(200);

    const refused = responses.find((r) => r.status() === 429)!;
    expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
    // Hebrew, like every other message the user can see.
    expect((await refused.json()).error).toMatch(/יותר מדי שאלות/);
  });

  test("one flooded caller does not lock anyone else out", async ({ request }) => {
    const flooder = "203.0.113.12";
    await Promise.all(Array.from({ length: 80 }, () => ask(request, flooder)));

    const bystander = await ask(request, "203.0.113.13");
    expect(bystander.status()).toBe(200);
  });

  test("reports the day's remaining model budget on /api/health", async ({ request }) => {
    const health = await (await request.get("/api/health")).json();
    expect(health.budget.llmQuestionsLimit).toBeGreaterThan(0);
    expect(health.budget.llmQuestionsRemaining).toBeLessThanOrEqual(
      health.budget.llmQuestionsLimit,
    );
    // Stated, not implied: the counter is per instance.
    expect(health.budget.scope).toBe("instance");
  });
});
