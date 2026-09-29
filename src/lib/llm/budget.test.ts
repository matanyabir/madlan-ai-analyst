import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkRate, clientKey, takeLlmQuestion, budgetStats, budgetReset,
  rateBurst, dailyLlmQuestions,
} from "./budget";

beforeEach(() => {
  vi.unstubAllEnvs();
  budgetReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  budgetReset();
});

describe("clientKey", () => {
  const withHeaders = (h: Record<string, string>) =>
    new Request("https://example.com/api/ask", { method: "POST", headers: h });

  it("takes the first hop of x-forwarded-for, not the proxy", () => {
    // Vercel appends its own hops; the client is the leftmost entry.
    expect(clientKey(withHeaders({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })))
      .toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(withHeaders({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientKey(withHeaders({}))).toBe("unknown");
  });

  it("ignores an empty forwarded header rather than keying on nothing", () => {
    expect(clientKey(withHeaders({ "x-forwarded-for": "  ", "x-real-ip": "198.51.100.4" })))
      .toBe("198.51.100.4");
  });
});

describe("per-IP rate limit", () => {
  it("allows the burst and then refuses, with a usable retry-after", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < rateBurst(); i++) {
      expect(checkRate("1.1.1.1", t).ok).toBe(true);
    }
    const verdict = checkRate("1.1.1.1", t);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0);
      expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("refills over time instead of blocking for the rest of the day", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < rateBurst(); i++) checkRate("2.2.2.2", t);
    expect(checkRate("2.2.2.2", t).ok).toBe(false);

    // One minute later the bucket has taken on a full minute of refill.
    expect(checkRate("2.2.2.2", t + 60_000).ok).toBe(true);
  });

  /**
   * The bug this guards against: recording `updatedAt` on a rejected request
   * *and* charging it would reset the refill clock on every retry, so a caller
   * hammering the endpoint would never be let back in.
   */
  it("does not let a caller in a tight loop hold its own bucket closed", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < rateBurst(); i++) checkRate("3.3.3.3", t);
    for (let ms = 0; ms < 30_000; ms += 100) checkRate("3.3.3.3", t + ms);
    // Despite 300 rejected attempts in between, the refill still arrives.
    expect(checkRate("3.3.3.3", t + 60_000).ok).toBe(true);
  });

  it("keeps one caller's burst from spending another's", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < rateBurst(); i++) checkRate("4.4.4.4", t);
    expect(checkRate("4.4.4.4", t).ok).toBe(false);
    expect(checkRate("5.5.5.5", t).ok).toBe(true);
  });

  it("is configurable, so a deployment can tighten it without a code change", () => {
    vi.stubEnv("ASK_RATE_BURST", "2");
    expect(rateBurst()).toBe(2);
    const t = 1_700_000_000_000;
    expect(checkRate("6.6.6.6", t).ok).toBe(true);
    expect(checkRate("6.6.6.6", t).ok).toBe(true);
    expect(checkRate("6.6.6.6", t).ok).toBe(false);
  });

  it("ignores a nonsensical limit rather than locking everyone out", () => {
    vi.stubEnv("ASK_RATE_BURST", "not a number");
    expect(rateBurst()).toBe(12);
  });
});

describe("daily model budget", () => {
  it("defaults to the conservative row of the README's cost table", () => {
    // 10,000 requests/day at a 60% cache hit rate = 4,000 model-routed
    // questions, which is ~$18.65/day at the measured $0.0047 each.
    expect(dailyLlmQuestions()).toBe(4000);
  });

  it("spends the allowance, then reports that it is gone", () => {
    vi.stubEnv("LLM_DAILY_QUESTION_BUDGET", "3");
    const t = Date.parse("2026-09-29T10:00:00Z");
    expect(takeLlmQuestion(t)).toBe(true);
    expect(takeLlmQuestion(t)).toBe(true);
    expect(takeLlmQuestion(t)).toBe(true);
    expect(takeLlmQuestion(t)).toBe(false);
    expect(takeLlmQuestion(t)).toBe(false);
  });

  it("resets on the UTC day boundary, not on a restart", () => {
    vi.stubEnv("LLM_DAILY_QUESTION_BUDGET", "1");
    const today = Date.parse("2026-09-29T23:59:00Z");
    const tomorrow = Date.parse("2026-09-30T00:01:00Z");
    expect(takeLlmQuestion(today)).toBe(true);
    expect(takeLlmQuestion(today)).toBe(false);
    expect(takeLlmQuestion(tomorrow)).toBe(true);
  });

  it("can be set to zero, which is the kill switch without a redeploy", () => {
    vi.stubEnv("LLM_DAILY_QUESTION_BUDGET", "0");
    expect(takeLlmQuestion()).toBe(false);
  });
});

describe("budgetStats", () => {
  it("reports what is left and what it has cost so far", () => {
    vi.stubEnv("LLM_DAILY_QUESTION_BUDGET", "100");
    const t = Date.parse("2026-09-29T10:00:00Z");
    for (let i = 0; i < 10; i++) takeLlmQuestion(t);

    const stats = budgetStats(t);
    expect(stats.llmQuestionsUsed).toBe(10);
    expect(stats.llmQuestionsRemaining).toBe(90);
    expect(stats.estimatedSpendUsd).toBeCloseTo(0.05, 2);
    // Stated plainly, because it is the number's real scope.
    expect(stats.scope).toBe("instance");
  });

  it("shows a fresh allowance once the day has rolled over", () => {
    vi.stubEnv("LLM_DAILY_QUESTION_BUDGET", "100");
    const today = Date.parse("2026-09-29T10:00:00Z");
    takeLlmQuestion(today);
    expect(budgetStats(Date.parse("2026-09-30T10:00:00Z")).llmQuestionsUsed).toBe(0);
  });
});
