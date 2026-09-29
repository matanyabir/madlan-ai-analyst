import type { Snapshot } from "@/lib/types";
import {
  getClient, isTransient, readUsage, MODEL, ROUTER_MAX_TOKENS, ROUTER_TIMEOUT_MS,
  type Usage, Anthropic,
} from "./client";
import { buildToolDefinitions } from "./tools";
import type { ToolCall } from "./execute";

/**
 * Call 1 — turn a Hebrew question into one validated tool call.
 *
 * The model's entire job here is language: work out what is being asked and
 * which parameters were named. It picks the operation; it does not perform
 * it, and it never sees a transaction row.
 */

const SYSTEM = `אתה מנתב שאלות במערכת ניתוח עסקאות נדל"ן בישראל.

תפקידך היחיד: להבין מה המשתמש שואל בעברית, ולבחור כלי אחד עם הפרמטרים הנכונים.
אתה לא מחשב ולא מעריך מספרים. כל חישוב נעשה בקוד, על הנתונים עצמם.

כללים:
- בחר תמיד כלי אחד בדיוק.
- השתמש רק בערכים המופיעים ברשימות המותרות בסכימה. אל תמציא שם עיר או שכונה.
- אם המשתמש מציין עיר בכתיב לא תקני, מפה אותה לערך המותר הקרוב ביותר.
  לדוגמה "ת״א" ו"תל אביב" שניהם "תל אביב-יפו".
- מלא רק שדות שהמשתמש ציין במפורש. אל תוסיף מסננים שלא התבקשו.
- "מחיר" בהקשר של השוואה או מגמה משמעו price_per_sqm, אלא אם המשתמש ביקש
  במפורש את מחיר העסקה המלא.
- לשאלה על כמות עסקאות השתמש ב-get_statistics עם metric=count.
- אם השאלה נוגעת למידע שאינו במאגר — תחזיות, איכות חיים, בתי ספר, רעש,
  תחבורה, תשואה, המלצות השקעה, או מצב השוק היום — בחר answer_not_supported.
  עדיף לסרב מאשר לענות תשובה שאינה נתמכת בנתונים.`;

export interface RouteSuccess {
  ok: true;
  call: ToolCall;
  usage: Usage;
  latencyMs: number;
}

export interface RouteFailure {
  ok: false;
  reason: "no_api_key" | "timeout" | "no_tool_call" | "api_error";
  detail?: string;
  latencyMs: number;
}

export type RouteOutcome = RouteSuccess | RouteFailure;

export async function routeQuestion(
  snapshot: Snapshot,
  question: string,
): Promise<RouteOutcome> {
  const started = Date.now();
  const client = getClient();
  if (!client) return { ok: false, reason: "no_api_key", latencyMs: 0 };

  const tools = buildToolDefinitions(snapshot);

  const attempt = async (): Promise<Anthropic.Message> =>
    client.messages.create(
      {
        model: MODEL,
        max_tokens: ROUTER_MAX_TOKENS,
        // Stable prefix first, volatile question last, so the cached portion
        // is byte-identical across every request for a given snapshot.
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: tools as unknown as Anthropic.ToolUnion[],
        // The model must pick an operation; "no answer" is answer_not_supported,
        // which is itself a tool, so there is no unhandled third state.
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: question }],
      },
      { timeout: ROUTER_TIMEOUT_MS },
    );

  let message: Anthropic.Message;
  try {
    message = await attempt();
  } catch (err) {
    if (isTransient(err)) {
      try {
        message = await attempt();
      } catch (retryErr) {
        return {
          ok: false,
          reason: retryErr instanceof Anthropic.APIConnectionTimeoutError ? "timeout" : "api_error",
          detail: retryErr instanceof Error ? retryErr.message : String(retryErr),
          latencyMs: Date.now() - started,
        };
      }
    } else {
      return {
        ok: false,
        reason: err instanceof Anthropic.APIConnectionTimeoutError ? "timeout" : "api_error",
        detail: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started,
      };
    }
  }

  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) {
    return { ok: false, reason: "no_tool_call", latencyMs: Date.now() - started };
  }

  return {
    ok: true,
    call: { name: block.name, input: block.input },
    usage: readUsage(message.usage),
    latencyMs: Date.now() - started,
  };
}
