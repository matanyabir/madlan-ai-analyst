import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeQuestion, cacheKey, cacheGet, cacheSet, cacheStats, cacheClear,
} from "./responseCache";

beforeEach(cacheClear);

describe("normalizeQuestion", () => {
  it("collapses the variations that would otherwise split the cache", () => {
    const canonical = normalizeQuestion('איך השתנה המחיר למ"ר ברמת גן?');
    const variants = [
      "איך השתנה המחיר למ״ר ברמת גן",
      '  איך השתנה   המחיר למ"ר ברמת גן?  ',
      "איך השתנה המחיר למ”ר ברמת גן!",
    ];
    for (const v of variants) {
      expect(normalizeQuestion(v)).toBe(canonical);
    }
  });

  it("keeps genuinely different questions apart", () => {
    expect(normalizeQuestion("מה המחיר ברמת גן"))
      .not.toBe(normalizeQuestion("מה המחיר בגבעתיים"));
  });
});

describe("cacheKey", () => {
  it("changes when the snapshot changes, so an upload invalidates everything", () => {
    const q = "כמה עסקאות יש ברמת גן";
    expect(cacheKey(q, "v1")).not.toBe(cacheKey(q, "v2"));
  });

  it("is stable for the same question and snapshot", () => {
    expect(cacheKey("שאלה", "v1")).toBe(cacheKey("שאלה", "v1"));
  });
});

describe("cache behaviour", () => {
  it("returns what was stored and counts the hit", () => {
    cacheSet("k", { answer: 42 });
    expect(cacheGet("k")).toEqual({ answer: 42 });
    expect(cacheStats()).toMatchObject({ hits: 1, misses: 0 });
  });

  it("misses on an unknown key without throwing", () => {
    expect(cacheGet("nope")).toBeNull();
    expect(cacheStats().misses).toBe(1);
  });

  it("evicts the least recently used entry at capacity", () => {
    for (let i = 0; i < 500; i++) cacheSet(`k${i}`, i);
    cacheGet("k0"); // touch it, so it is no longer least recent
    cacheSet("overflow", "x");

    expect(cacheGet("k0")).toBe(0); // survived
    expect(cacheGet("k1")).toBeNull(); // evicted
    expect(cacheStats().entries).toBe(500);
  });

  it("reports a hit rate for /api/health", () => {
    cacheSet("a", 1);
    cacheGet("a");
    cacheGet("b");
    expect(cacheStats().hitRate).toBe(0.5);
  });
});
