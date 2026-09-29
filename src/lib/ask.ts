import type { Snapshot } from "@/lib/types";
import type { AnalysisResult } from "@/lib/analysis";
import { routeQuestion } from "@/lib/llm/router";
import { narrate, templateSummary } from "@/lib/llm/narrator";
import { fallbackRoute } from "@/lib/llm/fallbackRouter";
import { executeToolCall } from "@/lib/llm/execute";
import { llmAvailable } from "@/lib/llm/client";
import { cacheGet, cacheKey, cacheSet } from "@/lib/cache/responseCache";

/**
 * The whole request path, in one place.
 *
 *   cache → route (Claude, else deterministic) → validate → analyse
 *         → narrate (Claude, else template) → cache → respond
 *
 * Nothing between "analyse" and the client can change a number. The narrator
 * receives the finished result and returns prose; if it fails, the template
 * writes prose from the same evidence. Either way the figures are identical.
 */

export type DegradedReason =
  | "no_api_key"
  | "ai_disabled"
  | "router_timeout"
  | "router_error"
  | "router_no_tool_call"
  | "router_invalid_arguments"
  | "narrator_unavailable"
  | "budget_exhausted";

export interface AskAnswer {
  question: string;
  result: AnalysisResult;
  summary: string;
  /** True when any part of the answer came from the deterministic path. */
  degraded: boolean;
  degradedReasons: DegradedReason[];
  meta: {
    toolName: string;
    routedBy: "llm" | "deterministic";
    narratedBy: "llm" | "template";
    cached: boolean;
    latencyMs: number;
    snapshotVersion: string;
    usage?: {
      routerInputTokens: number;
      routerOutputTokens: number;
      narratorInputTokens: number;
      narratorOutputTokens: number;
      cacheReadTokens: number;
    };
  };
}

export const MAX_QUESTION_LENGTH = 400;

export class QuestionError extends Error {}

export interface AskOptions {
  /** Skips both the read and the write. Used by tests and the admin preview. */
  skipCache?: boolean;
  /**
   * Set false to answer this request without the model. Passed in from the
   * route handler, which reads it from the request's cookie — server-side
   * global state cannot work across serverless instances.
   */
  useLlm?: boolean;
  /**
   * Spends one question from the day's model budget, returning false when the
   * allowance is gone. Called only after the cache misses, so a cached answer
   * is free in every sense. Absent — tests, the admin preview — means no
   * ceiling applies.
   */
  takeBudget?: () => boolean;
}

export async function ask(
  snapshot: Snapshot,
  rawQuestion: string,
  options: AskOptions = {},
): Promise<AskAnswer> {
  const started = Date.now();
  const question = rawQuestion.trim();

  if (!question) throw new QuestionError("לא הוזנה שאלה");
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new QuestionError(`השאלה ארוכה מדי — עד ${MAX_QUESTION_LENGTH} תווים`);
  }

  // What this caller is entitled to ask for, before the day's budget is
  // consulted. The cache key is built from this rather than from the eventual
  // outcome, and that is safe in the one direction that matters: a
  // budget-exhausted answer is degraded, degraded answers are never cached, so
  // the "llm" key can only ever hold prose the model actually wrote.
  const llmWanted = (options.useLlm ?? true) && llmAvailable();
  const key = cacheKey(question, snapshot.version, llmWanted ? "llm" : "deterministic");
  if (!options.skipCache) {
    const hit = cacheGet<AskAnswer>(key);
    if (hit) {
      return { ...hit, meta: { ...hit.meta, cached: true, latencyMs: Date.now() - started } };
    }
  }

  const degradedReasons: DegradedReason[] = [];

  // Charged here, past the cache, so repeat questions cost nothing.
  const llmAllowed = llmWanted && (options.takeBudget?.() ?? true);

  // ---------------------------------------------------------------- route
  let call = null as ReturnType<typeof fallbackRoute> | null;
  let routedBy: "llm" | "deterministic" = "deterministic";
  let routerUsage = { input: 0, output: 0, cacheRead: 0 };

  if (!llmWanted) {
    degradedReasons.push(llmAvailable() ? "ai_disabled" : "no_api_key");
  } else if (!llmAllowed) {
    // The day's allowance is spent. Not an error: the deterministic path below
    // answers the same question from the same evidence, for nothing.
    degradedReasons.push("budget_exhausted");
  } else {
    const routed = await routeQuestion(snapshot, question);
    if (routed.ok) {
      // Validate before trusting it. An invalid call falls through to the
      // deterministic router rather than becoming an error page.
      const trial = executeToolCall(snapshot, routed.call);
      if (trial.ok) {
        call = routed.call;
        routedBy = "llm";
        routerUsage = {
          input: routed.usage.inputTokens,
          output: routed.usage.outputTokens,
          cacheRead: routed.usage.cacheReadTokens,
        };
      } else {
        degradedReasons.push("router_invalid_arguments");
      }
    } else {
      degradedReasons.push(
        routed.reason === "timeout" ? "router_timeout"
          : routed.reason === "no_tool_call" ? "router_no_tool_call"
          : routed.reason === "no_api_key" ? "no_api_key"
          : "router_error",
      );
    }
  }

  call ??= fallbackRoute(snapshot, question);

  // -------------------------------------------------------------- analyse
  const executed = executeToolCall(snapshot, call);
  if (!executed.ok) {
    // Only reachable if the deterministic router emitted something invalid,
    // which its tests forbid. Fail loudly rather than serving nonsense.
    throw new QuestionError("לא הצלחנו לפרש את השאלה. נסו לנסח אותה אחרת.");
  }
  const result = executed.result;

  // -------------------------------------------------------------- narrate
  const narration = llmAllowed
    ? await narrate(result)
    : { summary: templateSummary(result), source: "template" as const, latencyMs: 0 };
  if (narration.source === "template" && llmAllowed) {
    degradedReasons.push("narrator_unavailable");
  }

  const answer: AskAnswer = {
    question,
    result,
    summary: narration.summary,
    degraded: degradedReasons.length > 0,
    degradedReasons,
    meta: {
      toolName: executed.call.name,
      routedBy,
      narratedBy: narration.source,
      cached: false,
      latencyMs: Date.now() - started,
      snapshotVersion: snapshot.version,
      usage: {
        routerInputTokens: routerUsage.input,
        routerOutputTokens: routerUsage.output,
        narratorInputTokens: narration.usage?.inputTokens ?? 0,
        narratorOutputTokens: narration.usage?.outputTokens ?? 0,
        cacheReadTokens: routerUsage.cacheRead + (narration.usage?.cacheReadTokens ?? 0),
      },
    },
  };

  // A degraded answer is still correct, so it is still worth caching — but
  // only briefly, so the next request after recovery gets the better prose.
  if (!options.skipCache && !answer.degraded) cacheSet(key, answer);

  return answer;
}

export { templateSummary };
