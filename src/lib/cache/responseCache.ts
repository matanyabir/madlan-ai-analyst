import { createHash } from "node:crypto";

/**
 * In-process LRU for whole answers.
 *
 * At 10,000 questions a day most traffic is the same handful of questions —
 * the example prompts, and the obvious variations on them. Caching the whole
 * answer removes both LLM calls, which is the single largest cost lever here.
 *
 * Keyed on the normalized question *and* the snapshot version, so an admin
 * upload invalidates every entry automatically rather than serving answers
 * computed from data that no longer exists.
 *
 * Deliberately in-process: it is the right size for this deployment and has
 * no operational cost. At 10x traffic across many instances this becomes
 * Redis, which changes this file and nothing else.
 */

const MAX_ENTRIES = 500;
const TTL_MS = 60 * 60 * 1000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
let hits = 0;
let misses = 0;

/**
 * Collapses whitespace, case and Hebrew punctuation variants so that two
 * spellings of the same question share one entry. Gershayim and ASCII quotes
 * are interchangeable in practice when users type a Hebrew abbreviation.
 */
export function normalizeQuestion(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/[״“”"]/g, '"')
    .replace(/[׳‘’']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[?!.,،]+$/u, "");
}

/**
 * The mode is part of the key, not a detail.
 *
 * An answer produced with the model carries model-written prose and
 * `degraded: false`. Serving it to someone who switched the model off would
 * show them fluent text and no badge while claiming the model was not used.
 * The numbers would be right and the provenance would be a lie.
 */
export function cacheKey(
  question: string,
  snapshotVersion: string,
  mode: "llm" | "deterministic" = "llm",
): string {
  return createHash("sha256")
    .update(`${snapshotVersion} ${mode} ${normalizeQuestion(question)}`)
    .digest("hex")
    .slice(0, 32);
}

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    misses++;
    return null;
  }
  // Refresh recency: re-insertion moves the key to the end of the Map.
  store.delete(key);
  store.set(key, entry);
  hits++;
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T): void {
  if (store.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the least recent.
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function cacheStats() {
  const total = hits + misses;
  return {
    entries: store.size,
    hits,
    misses,
    hitRate: total ? Number((hits / total).toFixed(3)) : 0,
  };
}

export function cacheClear(): void {
  store.clear();
  hits = 0;
  misses = 0;
}
