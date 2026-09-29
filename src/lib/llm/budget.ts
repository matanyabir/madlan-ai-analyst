/**
 * A ceiling on what strangers can spend.
 *
 * `/api/ask` is public — the brief requires a URL anyone can open — and every
 * uncached question on it costs about $0.0047 of someone's money. Knowing that
 * number is not the same as bounding it: without this file one visitor with a
 * loop, or one crawler that finds the endpoint, spends without limit, and the
 * admin kill switch only helps after someone notices.
 *
 * So there are two guards, and they fail in deliberately different ways:
 *
 *   1. A per-IP token bucket. This is the abuse guard. Exceeding it is a 429,
 *      because a caller sending 20 questions a second is not a user whose
 *      answer we want to improve.
 *
 *   2. A daily allowance of model-routed questions. This is the budget guard,
 *      and exceeding it is NOT an error — the request falls through to the
 *      deterministic router and the template narrator, which already exist for
 *      the model being down and answer the same question from the same
 *      evidence. The site keeps working at zero marginal cost, and the UI says
 *      the explanation is templated. Running out of money should look like the
 *      model being unavailable, because that is exactly what it is.
 *
 * The default allowance is 4,000 questions/day: the conservative row of the
 * README's cost table, the one that assumes a 60% cache hit rate at 10,000
 * requests/day. Holding that as a hard limit rather than a projection caps the
 * bill at roughly $18.65/day.
 *
 * **The honest limitation.** This state is per serverless instance, for the
 * reason `lib/serverState.ts` sets out at length: `globalThis` is not shared
 * across instances. So N instances permit N × the allowance, and a distributed
 * caller gets N × the burst. That makes this a bound rather than a precise
 * one — which is still categorically better than none, and it is computable
 * from the instance count. The exact version is a counter in Redis or Postgres,
 * and it is the same shared-storage step the response cache and the AI switch
 * both need; it would change this file and nothing else.
 */

const KEY = Symbol.for("madlan.budget");

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface BudgetState {
  buckets: Map<string, Bucket>;
  /** UTC day, so the allowance resets at a time that is the same everywhere. */
  day: string;
  llmQuestionsUsed: number;
}

type GlobalWithBudget = typeof globalThis & { [KEY]?: BudgetState };

function state(): BudgetState {
  const g = globalThis as GlobalWithBudget;
  g[KEY] ??= { buckets: new Map(), day: utcDay(Date.now()), llmQuestionsUsed: 0 };
  return g[KEY];
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Read lazily, not at module load, so a deployment can change the limits with
 * an environment variable and the tests can exercise the edges.
 */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Questions one IP may ask back-to-back before it has to wait. */
export const rateBurst = () => envInt("ASK_RATE_BURST", 12);
/** The sustained rate that bucket refills at. */
export const rateRefillPerMinute = () => envInt("ASK_RATE_PER_MINUTE", 20);
/** Model-routed questions per UTC day, across every visitor. */
export const dailyLlmQuestions = () => envInt("LLM_DAILY_QUESTION_BUDGET", 4000);

/**
 * Bounded so the limiter cannot itself become the memory leak. Buckets that
 * have fully refilled carry no information — the caller is back to its full
 * allowance — so they are the safe ones to forget.
 */
const MAX_TRACKED_CLIENTS = 5000;

/**
 * Identifies the caller.
 *
 * Vercel terminates TLS at the edge, so the socket address is a proxy; the
 * first hop of `x-forwarded-for` is the client. That header is trivially
 * forged, which matters for attribution and not for this: a forger gets their
 * own fresh bucket, so the per-IP limit becomes per-forged-identity, and the
 * daily allowance behind it still holds. Defeating a determined attacker needs
 * the platform's own edge rate limiting, which is where it belongs.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

export type RateVerdict =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function checkRate(key: string, now = Date.now()): RateVerdict {
  const burst = rateBurst();
  const perMs = rateRefillPerMinute() / 60_000;
  const { buckets } = state();

  const bucket = buckets.get(key) ?? { tokens: burst, updatedAt: now };
  // Refill for the time since we last saw this caller, never above the burst.
  const refilled = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * perMs);

  if (refilled < 1) {
    // Do not charge for a rejected request: writing `updatedAt` without
    // spending a token would otherwise let a fast enough loop hold the bucket
    // empty forever, since each rejection would reset the refill clock.
    buckets.set(key, { tokens: refilled, updatedAt: now });
    const seconds = perMs > 0 ? Math.ceil((1 - refilled) / perMs / 1000) : 60;
    return { ok: false, retryAfterSeconds: Math.max(1, seconds) };
  }

  evictIfCrowded(buckets, key, burst);
  buckets.set(key, { tokens: refilled - 1, updatedAt: now });
  return { ok: true };
}

function evictIfCrowded(buckets: Map<string, Bucket>, incoming: string, burst: number): void {
  if (buckets.size < MAX_TRACKED_CLIENTS || buckets.has(incoming)) return;
  for (const [k, b] of buckets) {
    if (b.tokens >= burst) buckets.delete(k);
  }
  // Still full of active callers: drop the least recently inserted, which Map
  // iteration order gives us for free.
  if (buckets.size >= MAX_TRACKED_CLIENTS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
}

/**
 * Spends one question from the day's allowance.
 *
 * Returns false when the allowance is gone, which the caller reads as "answer
 * this one without the model". Call it only once the response cache has
 * missed — a cached answer costs nothing and must not consume the budget.
 */
export function takeLlmQuestion(now = Date.now()): boolean {
  const s = state();
  const today = utcDay(now);
  if (s.day !== today) {
    s.day = today;
    s.llmQuestionsUsed = 0;
  }
  if (s.llmQuestionsUsed >= dailyLlmQuestions()) return false;
  s.llmQuestionsUsed++;
  return true;
}

/** For `/api/health`: the operational numbers worth watching during a demo. */
export function budgetStats(now = Date.now()) {
  const s = state();
  const limit = dailyLlmQuestions();
  const used = s.day === utcDay(now) ? s.llmQuestionsUsed : 0;
  return {
    day: utcDay(now),
    llmQuestionsUsed: used,
    llmQuestionsLimit: limit,
    llmQuestionsRemaining: Math.max(0, limit - used),
    /** At the measured $0.0047 per uncached question. */
    estimatedSpendUsd: Number((used * 0.0047).toFixed(2)),
    trackedClients: s.buckets.size,
    /** Per instance — see the note at the top of lib/llm/budget.ts. */
    scope: "instance" as const,
  };
}

export function budgetReset(): void {
  const g = globalThis as GlobalWithBudget;
  delete g[KEY];
}
