import type { AnalysisResult } from "@/lib/analysis";
import {
  getClient, isTransient, readUsage, NARRATOR_MODEL, NARRATOR_MAX_TOKENS, NARRATOR_TIMEOUT_MS,
  type Usage, Anthropic,
} from "./client";

/**
 * Call 2 — write two sentences of Hebrew about an already-computed result.
 *
 * The model receives the *verified* result and nothing else: no raw rows, no
 * database access, no ability to recompute. Every number it could mention is
 * already in front of it and already correct. That is the whole grounding
 * strategy — not a prompt instruction not to hallucinate, but an input from
 * which hallucinating a figure is the harder option.
 *
 * If this call fails the product still works: templateSummary() below writes
 * the same kind of sentence from the same evidence object, deterministically.
 */

const SYSTEM = `אתה אנליסט נדל"ן שכותב בעברית.

קיבלת תוצאה שכבר חושבה במלואה מתוך מאגר עסקאות נדל"ן. תפקידך לנסח
תובנה קצרה וברורה בעברית.

כללים מוחלטים:
- אל תמציא, תשנה או תחשב מספרים. השתמש אך ורק במספרים שמופיעים בתוצאה.
- אל תוסיף מידע שאינו בתוצאה.
- נסח תמיד ביחס למאגר: "בעסקאות שנמצאו במאגר..." ולא "מחיר השוק הוא...".
- אסור לטעון על מצב השוק היום, על תחזיות עתידיות, על סיבתיות, על איכות
  השכונה, על כדאיות השקעה, או על כל דבר שאינו עולה ישירות מהנתונים.
- אם התוצאה מבוססת על מעט עסקאות, ציין זאת.
- במגמה לאורך זמן: אל תחשב שינוי באחוזים בעצמך. אם יש שדה change השתמש
  במספר שבו בלבד וציין על כמה עסקאות הוא מבוסס. אם changeIsAvailable הוא
  false — אמור במפורש שאין מספיק נתונים כדי לקבוע שינוי, ואל תרמוז על כיוון.
- אם התוצאה היא עסקאות חריגות — חריגה משמעה שונות סטטיסטית מקבוצת השוואה,
  לעולם לא טעות בנתונים ולא מחיר שגוי.

אורך: שני משפטים, שלושה לכל היותר. בלי כותרת, בלי רשימות, בלי עיצוב.
טקסט רגיל בלבד.`;

export interface NarrationOutcome {
  summary: string;
  source: "llm" | "template";
  usage?: Usage;
  latencyMs: number;
}

/**
 * Trimmed view of the result. Deal lists are capped at five rows — the model
 * is writing a summary, not reading a table, and this keeps the prompt small
 * enough to matter at 10k requests a day.
 */
function promptPayload(result: AnalysisResult): string {
  const base = {
    type: result.type,
    title: result.title,
    evidence: {
      transactionCount: result.evidence.transactionCount,
      dateRange: result.evidence.dateRange,
      filters: result.evidence.filters,
      metric: result.evidence.metric?.name,
      notes: result.evidence.notes,
    },
  };

  switch (result.type) {
    case "statistics": return JSON.stringify({ ...base, metrics: result.metrics });
    case "timeSeries": {
      // Only periods that clear the sample threshold are shown to the model,
      // and the change is the one the engine vetted -- never the raw
      // endpoints, which may each rest on a single deal.
      const solid = result.points.filter((p) => !p.sparse);
      return JSON.stringify({
        ...base,
        metricLabel: result.metricLabel,
        granularity: result.granularity,
        change: result.change,
        changeIsAvailable: result.change !== null,
        first: solid[0], last: solid.at(-1),
        lowest: [...solid].sort((a, b) => a.value - b.value)[0],
        highest: [...solid].sort((a, b) => b.value - a.value)[0],
        pointCount: result.points.length,
        sparsePointCount: result.points.length - solid.length,
      });
    }
    case "comparison": return JSON.stringify({ ...base, items: result.items });
    case "dealList": return JSON.stringify({
      ...base, shown: result.deals.length,
      deals: result.deals.slice(0, 5).map((d) => ({
        city: d.city, neighborhood: d.neighborhood, rooms: d.rooms,
        sizeSqm: d.sizeSqm, priceNis: d.priceNis, pricePerSqm: d.pricePerSqm,
        dealDate: d.dealDate,
        similarityScore: d.similarity?.score,
        anomalyZ: d.anomaly?.modifiedZ, anomalyDirection: d.anomaly?.direction,
        peerMedian: d.anomaly?.peerMedian,
      })),
    });
    case "propertyComparison": return JSON.stringify({ ...base, subject: result.subject, others: result.others });
    case "text":
    case "insufficient": return JSON.stringify({ ...base, message: "body" in result ? result.body : result.message });
  }
}

export async function narrate(result: AnalysisResult): Promise<NarrationOutcome> {
  const started = Date.now();
  const client = getClient();
  if (!client) {
    return { summary: templateSummary(result), source: "template", latencyMs: 0 };
  }

  const attempt = async () =>
    client.messages.create(
      {
        model: NARRATOR_MODEL,
        max_tokens: NARRATOR_MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: promptPayload(result) }],
      },
      { timeout: NARRATOR_TIMEOUT_MS },
    );

  try {
    let message: Anthropic.Message;
    try {
      message = await attempt();
    } catch (err) {
      if (!isTransient(err)) throw err;
      message = await attempt();
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    // An empty or truncated narration is a failure, not an answer.
    if (!text || message.stop_reason === "max_tokens") {
      return { summary: templateSummary(result), source: "template", latencyMs: Date.now() - started };
    }

    return {
      summary: text,
      source: "llm",
      usage: readUsage(message.usage),
      latencyMs: Date.now() - started,
    };
  } catch {
    return { summary: templateSummary(result), source: "template", latencyMs: Date.now() - started };
  }
}

const nis = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;

function heDate(iso: string): string {
  const [y, m] = iso.split("-");
  const months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
  return `${months[Number(m) - 1]} ${y}`;
}

/**
 * The deterministic narrator.
 *
 * Used when the model is unavailable, slow, or returns nothing usable — and
 * it is written from the same evidence object, so its claims are exactly as
 * grounded as the model's. This is what "survives the model being
 * unavailable" means in practice: a plainer sentence, not a broken page.
 */
export function templateSummary(result: AnalysisResult): string {
  const e = result.evidence;
  const period = e.dateRange
    ? ` בין ${heDate(e.dateRange.min)} ל${heDate(e.dateRange.max)}`
    : "";
  const basis = `מבוסס על ${e.transactionCount} עסקאות${period}.`;

  switch (result.type) {
    case "statistics": {
      const median = result.metrics.find((m) => m.label.startsWith("חציון"));
      const count = result.metrics.find((m) => m.label === "מספר עסקאות");
      if (median) {
        return `${basis} חציון ${result.evidence.metric?.name ?? "המדד"} הוא ${
          median.unit === "count" ? median.value : nis(median.value)
        }${median.unit === "nis_per_sqm" ? " למ״ר" : ""}.`;
      }
      return `נמצאו ${count?.value ?? e.transactionCount} עסקאות במאגר התואמות את הסינון. ${period ? `הטווח:${period}.` : ""}`;
    }

    case "timeSeries": {
      const unit = { month: "חודש", quarter: "רבעון", year: "שנה" }[result.granularity];
      if (!result.change) {
        // Refusing to state a change is the correct answer here, not a gap.
        return (
          `${basis} הנתונים מוצגים לפי ${unit}, אך אין מספיק עסקאות בתקופות ` +
          `הקצה כדי לקבוע שינוי אמין לאורך הזמן.`
        );
      }
      const { percent, fromPeriod, toPeriod, fromN, toN } = result.change;
      const dir = percent >= 0 ? "עלייה" : "ירידה";
      return (
        `${basis} בין ${fromPeriod} ל${toPeriod} נרשמה ${dir} של ` +
        `${Math.abs(percent).toFixed(1)}% ב${result.metricLabel}, ` +
        `על בסיס ${fromN} ו-${toN} עסקאות בתקופות הקצה בהתאמה. ` +
        `הנתונים מקובצים לפי ${unit}.`
      );
    }

    case "comparison": {
      const [top, ...rest] = result.items;
      const bottom = rest.at(-1);
      if (!bottom) return basis;
      const gap = ((top.value / bottom.value - 1) * 100).toFixed(0);
      return (
        `${basis} ${top.label} מוביל עם ${nis(top.value)} לעומת ${nis(bottom.value)} ב${bottom.label} — ` +
        `פער של ${gap}% ב${result.metricLabel}.`
      );
    }

    case "dealList": {
      const anomalies = result.deals.filter((d) => d.anomaly).length;
      if (anomalies) {
        return `נמצאו ${anomalies} עסקאות שסוטות סטטיסטית מקבוצת ההשוואה שלהן. ${basis} חריגה משמעה שונות סטטיסטית, לא שגיאה בנתונים.`;
      }
      const withScores = result.deals.filter((d) => d.similarity);
      if (withScores.length) {
        const pps = withScores
          .map((d) => d.pricePerSqm)
          .filter((v): v is number => v != null);
        const med = pps.length ? pps.sort((a, b) => a - b)[Math.floor(pps.length / 2)] : null;
        return (
          `נמצאו ${withScores.length} עסקאות דומות במאגר${med ? `, בחציון של ${nis(med)} למ״ר` : ""}. ` +
          `הדירוג לפי שטח, מספר חדרים, עדכניות, סוג נכס ושכונה.`
        );
      }
      return `${basis} מוצגות ${result.deals.length} עסקאות.`;
    }

    case "propertyComparison":
      return `השוואה בין ${result.others.length + 1} נכסים על בסיס הנתונים במאגר.`;

    case "text":
      return result.body;

    case "insufficient":
      return result.message;
  }
}
