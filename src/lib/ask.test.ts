import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getSnapshot } from "@/lib/snapshot";
import { ask, QuestionError } from "./ask";
import { cacheClear } from "@/lib/cache/responseCache";
import * as client from "@/lib/llm/client";
import * as router from "@/lib/llm/router";
import * as narrator from "@/lib/llm/narrator";

const snap = getSnapshot();

/**
 * These run with no ANTHROPIC_API_KEY, which is the point: the entire
 * product must work end to end with the model unavailable. The five demo
 * questions are answered here by the deterministic path alone.
 */
beforeEach(() => {
  cacheClear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ask with no LLM configured", () => {
  it("still answers the trend question, flagged as degraded", async () => {
    const a = await ask(snap, 'איך השתנה המחיר למ"ר ברמת גן?');
    expect(a.result.type).toBe("timeSeries");
    expect(a.degraded).toBe(true);
    expect(a.degradedReasons).toContain("no_api_key");
    expect(a.meta.routedBy).toBe("deterministic");
    expect(a.meta.narratedBy).toBe("template");
    // The prose is plainer, but it is real and it is grounded.
    expect(a.summary.length).toBeGreaterThan(20);
    expect(a.summary).toMatch(/עסקאות/);
  });

  it.each([
    ['איך השתנה המחיר למ"ר ברמת גן?', "timeSeries"],
    ["תשווה בין רמת גן לגבעתיים", "comparison"],
    ['מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ"ר ברמת גן', "dealList"],
    ["כמה עסקאות של 4 חדרים יש בחיפה?", "statistics"],
    ["מצא עסקאות חריגות", "dealList"],
  ])("answers %s with a %s", async (question, expectedType) => {
    const a = await ask(snap, question);
    expect(a.result.type).toBe(expectedType);
    expect(a.result.evidence.snapshotVersion).toBe(snap.version);
    expect(a.summary).toBeTruthy();
  });

  it("declines an unsupported question without inventing a figure", async () => {
    const a = await ask(snap, "איזו שכונה הכי שקטה ברמת גן?");
    expect(a.result.type).toBe("text");
    expect(a.result.evidence.transactionCount).toBe(0);
    // No numbers at all in the answer to a question the data cannot support.
    expect(a.summary).not.toMatch(/\d{4,}/);
  });

  it("declines a forecast question", async () => {
    const a = await ask(snap, "כמה יעלו דירות ברמת גן ב-2030?");
    expect(a.result.type).toBe("text");
    expect(a.result.title).toContain("לא מכיל");
  });
});

describe("ask survives the model failing at each stage", () => {
  it("falls back when the router times out", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: false, reason: "timeout", latencyMs: 6000,
    });
    // Narrator has no client of its own to reach, so it templates too.
    vi.spyOn(client, "getClient").mockReturnValue(null);

    const a = await ask(snap, "כמה עסקאות של 4 חדרים יש ברמת גן?");
    expect(a.result.type).toBe("statistics");
    expect(a.degradedReasons).toContain("router_timeout");
    expect(a.summary).toBeTruthy();
  });

  it("falls back when the router returns arguments we reject", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: true,
      // Plausible-looking but invalid: limit far over the cap.
      call: { name: "search_transactions", input: { limit: 100000 } },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 300,
    });
    vi.spyOn(client, "getClient").mockReturnValue(null);

    const a = await ask(snap, "הראה לי עסקאות בחולון");
    expect(a.degradedReasons).toContain("router_invalid_arguments");
    expect(a.meta.routedBy).toBe("deterministic");
    expect(a.result.type).toBe("dealList");
  });

  it("falls back when the model picks a tool that does not exist", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: true,
      call: { name: "run_sql", input: { query: "SELECT 1" } },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 300,
    });
    vi.spyOn(client, "getClient").mockReturnValue(null);

    const a = await ask(snap, "כמה עסקאות יש בנתניה?");
    expect(a.degradedReasons).toContain("router_invalid_arguments");
    expect(a.result.type).toBe("statistics");
  });
});

describe("caching", () => {
  /** Puts the pipeline in a fully-successful state so answers are cacheable. */
  function stubHealthyLlm(toolInput: Record<string, unknown>) {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: true,
      call: { name: "get_statistics", input: toolInput },
      usage: { inputTokens: 1300, outputTokens: 120, cacheReadTokens: 1100, cacheWriteTokens: 0 },
      latencyMs: 200,
    });
    vi.spyOn(narrator, "narrate").mockResolvedValue({
      summary: "בעסקאות שנמצאו במאגר נרשמו 29 עסקאות ברמת גן.",
      source: "llm",
      usage: { inputTokens: 1100, outputTokens: 200, cacheReadTokens: 900, cacheWriteTokens: 0 },
      latencyMs: 400,
    });
  }

  it("serves a repeat question from cache, with zero LLM calls", async () => {
    stubHealthyLlm({ filters: { city: "רמת גן" }, metric: "count" });

    const first = await ask(snap, "כמה עסקאות יש ברמת גן?");
    expect(first.degraded).toBe(false);
    expect(first.meta.cached).toBe(false);
    expect(router.routeQuestion).toHaveBeenCalledTimes(1);

    const second = await ask(snap, "כמה עסקאות יש ברמת גן?");
    expect(second.meta.cached).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.summary).toBe(first.summary);
    // The whole point: the second request costs nothing.
    expect(router.routeQuestion).toHaveBeenCalledTimes(1);
    expect(narrator.narrate).toHaveBeenCalledTimes(1);
  });

  it("treats punctuation and spacing variants as the same question", async () => {
    stubHealthyLlm({ filters: { city: "רמת גן" }, metric: "count" });

    await ask(snap, 'כמה עסקאות למ"ר יש ברמת גן?');
    const variant = await ask(snap, "  כמה עסקאות למ״ר יש ברמת גן  ");
    expect(variant.meta.cached).toBe(true);
    expect(router.routeQuestion).toHaveBeenCalledTimes(1);
  });

  it("does not cache a degraded answer, so recovery restores better prose", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: false, reason: "timeout", latencyMs: 6000,
    });
    vi.spyOn(client, "getClient").mockReturnValue(null);

    const first = await ask(snap, "כמה עסקאות יש בחולון?");
    expect(first.degraded).toBe(true);
    const second = await ask(snap, "כמה עסקאות יש בחולון?");
    expect(second.meta.cached).toBe(false);
  });

  it("a new snapshot version invalidates every cached answer", async () => {
    stubHealthyLlm({ filters: { city: "רמת גן" }, metric: "count" });
    await ask(snap, "כמה עסקאות יש ברמת גן?");

    const uploaded = { ...snap, version: "deadbeefcafe" };
    const after = await ask(uploaded, "כמה עסקאות יש ברמת גן?");
    expect(after.meta.cached).toBe(false);
  });

  it("reports token usage so cost can be measured, not guessed", async () => {
    stubHealthyLlm({ filters: { city: "רמת גן" }, metric: "count" });
    const a = await ask(snap, "כמה עסקאות יש ברמת גן?");
    expect(a.meta.usage).toEqual({
      routerInputTokens: 1300,
      routerOutputTokens: 120,
      narratorInputTokens: 1100,
      narratorOutputTokens: 200,
      cacheReadTokens: 2000,
    });
  });
});

describe("the daily model budget", () => {
  /** Puts the pipeline in a fully-successful state so answers are cacheable. */
  function stubHealthyLlm() {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-fake");
    vi.spyOn(router, "routeQuestion").mockResolvedValue({
      ok: true,
      call: { name: "get_statistics", input: { filters: { city: "\u05e8\u05de\u05ea \u05d2\u05df" }, metric: "count" } },
      usage: { inputTokens: 1300, outputTokens: 120, cacheReadTokens: 1100, cacheWriteTokens: 0 },
      latencyMs: 200,
    });
    vi.spyOn(narrator, "narrate").mockResolvedValue({
      summary: "\u05d1\u05de\u05d0\u05d2\u05e8 \u05e0\u05e8\u05e9\u05de\u05d5 29 \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea \u05d1\u05e8\u05de\u05ea \u05d2\u05df.",
      source: "llm",
      usage: { inputTokens: 1100, outputTokens: 200, cacheReadTokens: 900, cacheWriteTokens: 0 },
      latencyMs: 400,
    });
  }

  const QUESTION = "\u05db\u05de\u05d4 \u05e2\u05e1\u05e7\u05d0\u05d5\u05ea \u05d9\u05e9 \u05d1\u05e8\u05de\u05ea \u05d2\u05df?";

  it("answers without the model once the allowance is gone, rather than failing", async () => {
    stubHealthyLlm();
    const a = await ask(snap, QUESTION, { takeBudget: () => false });

    // The user still gets the right answer, computed the same way.
    expect(a.result.type).toBe("statistics");
    expect(a.meta.routedBy).toBe("deterministic");
    expect(a.meta.narratedBy).toBe("template");
    expect(a.degradedReasons).toEqual(["budget_exhausted"]);
    // And it cost nothing: neither call was made.
    expect(router.routeQuestion).not.toHaveBeenCalled();
    expect(narrator.narrate).not.toHaveBeenCalled();
  });

  it("charges the budget only for questions the cache could not answer", async () => {
    stubHealthyLlm();
    const takeBudget = vi.fn(() => true);

    await ask(snap, QUESTION, { takeBudget });
    await ask(snap, QUESTION, { takeBudget });

    expect(takeBudget).toHaveBeenCalledTimes(1);
  });

  /**
   * The provenance trap: a budget-exhausted answer is templated but keyed as
   * if the model had written it. It must never reach the cache, or the next
   * visitor would be shown template prose with no badge.
   */
  it("never caches a budget-exhausted answer under the model's key", async () => {
    stubHealthyLlm();
    const exhausted = await ask(snap, QUESTION, { takeBudget: () => false });
    expect(exhausted.degraded).toBe(true);

    const recovered = await ask(snap, QUESTION, { takeBudget: () => true });
    expect(recovered.meta.cached).toBe(false);
    expect(recovered.meta.narratedBy).toBe("llm");
    expect(recovered.degraded).toBe(false);
  });

  it("leaves the budget alone when the model was already off", async () => {
    // No API key: there is nothing to spend, so nothing should be charged.
    const takeBudget = vi.fn(() => true);
    const a = await ask(snap, QUESTION, { takeBudget });
    expect(a.degradedReasons).toContain("no_api_key");
    expect(takeBudget).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  it("rejects an empty question", async () => {
    await expect(ask(snap, "   ")).rejects.toThrow(QuestionError);
  });

  it("rejects an over-long question rather than truncating it", async () => {
    await expect(ask(snap, "א".repeat(401))).rejects.toThrow(/ארוכה מדי/);
  });
});

describe("the answer never contradicts the engine", () => {
  it("reports the same numbers the analysis engine computed directly", async () => {
    const a = await ask(snap, "כמה עסקאות של 4 חדרים יש ברמת גן?");
    if (a.result.type !== "statistics") throw new Error("wrong type");

    const expected = snap.deals.filter(
      (d) => d.isAnalyzable && d.city === "רמת גן" && d.rooms === 4,
    ).length;
    expect(a.result.metrics.find((m) => m.label === "מספר עסקאות")!.value).toBe(expected);
  });
});
