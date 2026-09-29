import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude Haiku 4.5.
 *
 * Two calls per question at roughly 1.3k in / 120 out and 1.1k in / 200 out,
 * which at 10,000 questions a day with a 60% response-cache hit rate costs
 * about $9/day. The cost arithmetic is in the README.
 *
 * Model-specific notes, because these are easy to get wrong:
 *   - `thinking` is NOT sent. Adaptive thinking is a 4.6+ feature; Haiku 4.5
 *     takes budget_tokens, and neither is wanted here — call 1 is a
 *     classification and call 2 is two sentences.
 *   - `output_config.effort` errors on Haiku 4.5. Not sent.
 */
const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * Model per role, overridable without a code change.
 *
 * The three call sites have genuinely different requirements, which is why
 * they are configured separately rather than sharing one knob:
 *
 *   router        classification over a closed set of seven tools. A small
 *                 model is the right instrument, and this is the call that
 *                 moves to Jev (see provider.ts).
 *   narrator      open-ended Hebrew prose. The only place where model tier
 *                 is visible to the user.
 *   canonicalizer closed set again, and it runs once per upload rather than
 *                 per request, so cost barely matters here.
 *
 * LLM_MODEL overrides all three at once; the per-role vars take precedence.
 * Nothing validates the string against a list of known models on purpose —
 * a new model should be usable the day it ships, and an invalid id fails
 * loudly on the first call rather than silently.
 */
const pick = (specific: string | undefined, shared: string | undefined) =>
  specific?.trim() || shared?.trim() || DEFAULT_MODEL;

export const ROUTER_MODEL = pick(process.env.LLM_ROUTER_MODEL, process.env.LLM_MODEL);
export const NARRATOR_MODEL = pick(process.env.LLM_NARRATOR_MODEL, process.env.LLM_MODEL);
export const CANONICALIZER_MODEL = pick(
  process.env.LLM_CANONICALIZER_MODEL,
  process.env.LLM_MODEL,
);

/** @deprecated Prefer the per-role constants. Kept for the health endpoint. */
export const MODEL = DEFAULT_MODEL;

export const ROUTER_MAX_TOKENS = 512;
export const NARRATOR_MAX_TOKENS = 700;

/** Per-call wall clock. Past this the deterministic path takes over. */
export const ROUTER_TIMEOUT_MS = Number(process.env.LLM_ROUTER_TIMEOUT_MS ?? 6000);
export const NARRATOR_TIMEOUT_MS = Number(process.env.LLM_NARRATOR_TIMEOUT_MS ?? 6000);

/**
 * Runtime kill switch for the model, toggled by an admin.
 *
 * Instance-local and in-memory, exactly like the snapshot: it does not
 * survive a cold start and does not reach other instances. That is the same
 * honest limitation, and the admin UI says so.
 *
 * It exists for two reasons. Operationally it is the lever you want when the
 * model is misbehaving or burning budget and you do not want to redeploy to
 * stop it. For a demo it lets someone switch the LLM off and watch the same
 * questions still get answered by the deterministic path — which is easier
 * to believe than a paragraph claiming it works.
 */
let aiEnabled = true;

export function isAiEnabled(): boolean {
  return aiEnabled;
}

/** Returns the new state. */
export function setAiEnabled(next: boolean): boolean {
  aiEnabled = next;
  return aiEnabled;
}

let client: Anthropic | null = null;

/**
 * Null when no key is configured, or when an admin has switched the model
 * off — the app then runs entirely deterministically.
 */
export function getClient(): Anthropic | null {
  if (!aiEnabled) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({
    // One retry, and only for the transient classes. A schema failure is not
    // transient and retrying it just burns latency.
    maxRetries: 1,
  });
  return client;
}

export function llmAvailable(): boolean {
  return aiEnabled && Boolean(process.env.ANTHROPIC_API_KEY);
}

/** True when a key exists but an admin has turned the model off. */
export function llmKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Errors worth one retry. Anything else fails straight to the fallback. */
export function isTransient(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError
  );
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function readUsage(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export { Anthropic };
