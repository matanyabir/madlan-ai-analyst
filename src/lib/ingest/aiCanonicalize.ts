import type { Deal, IngestIssue } from "@/lib/types";
import { CANONICAL_CITIES } from "@/lib/normalize/aliases";
import { getClient, isTransient, MODEL, Anthropic } from "@/lib/llm/client";

/**
 * AI canonicalization — the one place the model touches the data.
 *
 * It runs *after* the deterministic rules, and only on what they could not
 * resolve: a city spelling absent from the committed alias table. In the
 * sample CSV that is zero rows; it exists for the next CSV, which will have
 * spellings nobody has seen yet.
 *
 * Three properties make this safe enough to let near the data:
 *
 *   1. **Closed output.** The tool schema enumerates the canonical city list,
 *      so `strict: true` means the model cannot return a city that does not
 *      exist. The answer is a choice, not a generation.
 *   2. **Whitelist re-check.** The returned value is verified against the
 *      list again server-side, because the schema is the model's promise.
 *   3. **Confidence thresholds.** High confidence applies; medium applies but
 *      is flagged for admin review; low is refused and the row is
 *      quarantined. A guess is never silently accepted.
 *
 * Cost: one call per upload regardless of file size — every unknown value in
 * the file is resolved in a single batched request, not one call per row.
 *
 * ── Next step: Jev AI ──
 * This is precisely a System One question. Jev's `choice` type takes the
 * canonical list as `criteria` and returns one of them with a calibrated
 * confidence — the same contract as below, with hallucination impossible by
 * construction rather than by schema enforcement, and at $0.042/M input with
 * free output. See lib/llm/provider.ts.
 */

/** At or above this, apply the mapping silently. */
export const CONFIDENCE_AUTO = 0.85;
/** At or above this, apply but flag for a human. Below, refuse. */
export const CONFIDENCE_REVIEW = 0.6;

/** One call handles this many unknown values; beyond it we stop and refuse. */
const MAX_VALUES_PER_CALL = 60;

const TIMEOUT_MS = 20_000;

export interface CanonicalizeResult {
  deals: Deal[];
  issues: IngestIssue[];
  /** Null when there was nothing to resolve or no model available. */
  stats: {
    unresolvedValues: number;
    applied: number;
    flaggedForReview: number;
    refused: number;
    llmCalls: number;
  } | null;
}

interface Mapping {
  rawValue: string;
  canonical: string;
  confidence: number;
  reasoning: string;
}

function collectUnresolvedCities(deals: Deal[]): string[] {
  const values = new Set<string>();
  for (const d of deals) {
    if (d.city === null && d.quarantineReasons.includes("unresolved_city")) {
      const raw = (d.raw.city ?? "").trim().replace(/\s+/g, " ");
      if (raw) values.add(raw);
    }
  }
  return [...values];
}

async function askClaude(values: string[]): Promise<Mapping[] | null> {
  const client = getClient();
  if (!client) return null;

  const tool = {
    name: "submit_city_mappings",
    description: "החזרת מיפוי מכל ערך גולמי לשם עיר קנוני מתוך הרשימה המותרת.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rawValue: { type: "string", description: "הערך הגולמי, בדיוק כפי שהתקבל" },
              // The closed set. The model cannot answer outside it.
              canonical: { type: "string", enum: CANONICAL_CITIES },
              confidence: {
                type: "number", minimum: 0, maximum: 1,
                description: "0 עד 1. ערך נמוך מ-0.6 יגרום לדחיית המיפוי",
              },
              reasoning: { type: "string", description: "משפט קצר בעברית: על מה מבוסס המיפוי" },
            },
            required: ["rawValue", "canonical", "confidence", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      required: ["mappings"],
      additionalProperties: false,
    },
  };

  const system =
    "אתה מנרמל שמות ערים בישראל בתוך קובץ עסקאות נדל\"ן.\n\n" +
    "עבור כל ערך גולמי, בחר את שם העיר הקנוני מתוך הרשימה המותרת בסכימה.\n" +
    "שקול שגיאות כתיב, קיצורים, כתיב מלא מול חסר, מקף מול רווח, ותעתיק מאנגלית.\n\n" +
    "החזר confidence נמוך כאשר אינך בטוח. עדיף לסמן ביטחון נמוך ולתת לאדם להכריע " +
    "מאשר לנחש: ערך שמתחת ל-0.6 נדחה והשורה מוצאת מהניתוחים, וזו תוצאה תקינה.\n" +
    "אם ערך גולמי אינו נראה כמו אף עיר ברשימה — תן לו confidence נמוך מאוד.";

  const attempt = () =>
    client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: [tool] as unknown as Anthropic.ToolUnion[],
        tool_choice: { type: "tool", name: "submit_city_mappings" },
        messages: [{
          role: "user",
          content: `ערכים לנרמול:\n${values.map((v) => `- ${JSON.stringify(v)}`).join("\n")}`,
        }],
      },
      { timeout: TIMEOUT_MS },
    );

  try {
    let message: Anthropic.Message;
    try {
      message = await attempt();
    } catch (err) {
      if (!isTransient(err)) throw err;
      message = await attempt();
    }

    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!block) return null;

    const input = block.input as { mappings?: unknown };
    return Array.isArray(input.mappings) ? (input.mappings as Mapping[]) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves what deterministic rules could not. Never throws: a failure here
 * leaves the rows quarantined, which is the same outcome as not running.
 */
export async function aiCanonicalize(
  deals: Deal[],
  issues: IngestIssue[],
): Promise<CanonicalizeResult> {
  const unresolved = collectUnresolvedCities(deals);
  if (!unresolved.length) return { deals, issues, stats: null };

  const batch = unresolved.slice(0, MAX_VALUES_PER_CALL);
  const mappings = await askClaude(batch);

  if (!mappings) {
    const failed: IngestIssue[] = unresolved.map((raw) => ({
      rowNumber: 0, dealId: "", field: "city", type: "ai_rejected",
      severity: "warning", rawValue: raw, resolvedValue: null, resolver: "none",
      note: "לא ניתן היה לפנות למנוע השפה. הערך נותר לא מזוהה והשורות הוצאו מהניתוחים",
    }));
    return { deals, issues: [...issues, ...failed], stats: null };
  }

  const accepted = new Map<string, { canonical: string; confidence: number; reasoning: string }>();
  const newIssues: IngestIssue[] = [];
  let applied = 0;
  let flagged = 0;
  let refused = 0;

  for (const raw of unresolved) {
    const m = mappings.find((x) => x?.rawValue === raw);
    const confidence = typeof m?.confidence === "number" ? m.confidence : 0;

    // Re-check against the whitelist: strict:true is the model's promise.
    const valid = m && CANONICAL_CITIES.includes(m.canonical);

    if (!valid || confidence < CONFIDENCE_REVIEW) {
      refused++;
      newIssues.push({
        rowNumber: 0, dealId: "", field: "city", type: "ai_rejected",
        severity: "error", rawValue: raw, resolvedValue: null, resolver: "ai",
        confidence,
        note: !valid
          ? "מנוע השפה החזיר ערך שאינו ברשימת הערים המותרות. המיפוי נדחה"
          : `רמת ביטחון ${(confidence * 100).toFixed(0)}% נמוכה מהסף. הערך נותר לא מזוהה`,
      });
      continue;
    }

    accepted.set(raw, { canonical: m.canonical, confidence, reasoning: m.reasoning ?? "" });
    const needsReview = confidence < CONFIDENCE_AUTO;
    if (needsReview) flagged++;
    else applied++;

    newIssues.push({
      rowNumber: 0, dealId: "", field: "city", type: "ai_canonicalized",
      severity: needsReview ? "warning" : "info",
      rawValue: raw, resolvedValue: m.canonical, resolver: "ai", confidence,
      note: needsReview
        ? `זוהה בביטחון ${(confidence * 100).toFixed(0)}% — מומלץ לאמת. ${m.reasoning ?? ""}`.trim()
        : m.reasoning,
    });
  }

  const patched = deals.map((d) => {
    if (d.city !== null || !d.quarantineReasons.includes("unresolved_city")) return d;
    const raw = (d.raw.city ?? "").trim().replace(/\s+/g, " ");
    const hit = accepted.get(raw);
    if (!hit) return d;

    const remaining = d.quarantineReasons.filter((r) => r !== "unresolved_city");
    return {
      ...d,
      city: hit.canonical,
      quarantineReasons: remaining,
      isAnalyzable: remaining.length === 0,
    };
  });

  return {
    deals: patched,
    issues: [...issues, ...newIssues],
    stats: {
      unresolvedValues: unresolved.length,
      applied, flaggedForReview: flagged, refused,
      llmCalls: 1,
    },
  };
}
