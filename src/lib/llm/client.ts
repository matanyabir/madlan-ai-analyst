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
export const MODEL = "claude-haiku-4-5";

export const ROUTER_MAX_TOKENS = 512;
export const NARRATOR_MAX_TOKENS = 700;

/** Per-call wall clock. Past this the deterministic path takes over. */
export const ROUTER_TIMEOUT_MS = Number(process.env.LLM_ROUTER_TIMEOUT_MS ?? 6000);
export const NARRATOR_TIMEOUT_MS = Number(process.env.LLM_NARRATOR_TIMEOUT_MS ?? 6000);

let client: Anthropic | null = null;

/** Null when no key is configured — the app then runs entirely deterministically. */
export function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({
    // One retry, and only for the transient classes. A schema failure is not
    // transient and retrying it just burns latency.
    maxRetries: 1,
  });
  return client;
}

export function llmAvailable(): boolean {
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
