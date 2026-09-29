import { z } from "zod";
import type { Snapshot } from "@/lib/types";
import { MAX_RESULT_ROWS } from "@/lib/analysis";

/**
 * The seven operations the model is allowed to invoke.
 *
 * Two layers, and it matters which one carries the guarantee:
 *
 *   1. The JSON Schema sent to Claude enumerates cities, neighbourhoods,
 *      property types and conditions from the *snapshot's own vocabulary*.
 *      This tells the model what exists. It is guidance, not enforcement.
 *
 *   2. The Zod schemas below re-validate every argument server-side. This is
 *      the actual guarantee. A malformed, unknown or out-of-range argument
 *      is rejected and the request falls to the deterministic router rather
 *      than producing a confidently wrong answer.
 *
 * `strict: true` is deliberately NOT set, and the reason is a hard API
 * limit rather than a preference: strict mode allows at most 24 optional
 * parameters across all tools, and a filter vocabulary rich enough to answer
 * real questions (city, neighbourhood, type, condition, rooms, size, price,
 * year, floor, four amenities, date range) repeated across five analysis
 * tools is 113. Keeping strict would mean cutting the product's query
 * surface to roughly four fields.
 *
 * Strict mode also rejects `minimum`/`maximum` on numbers and `minItems`
 * above 1 on arrays, so those bounds live in each property's description,
 * where the model reads them, and in Zod, where they are enforced.
 *
 * The model never receives SQL, a query language, or a free-text filter.
 */

export const METRICS = ["price_per_sqm", "price", "size", "count"] as const;
export const SORTS = ["recent", "price_desc", "price_asc"] as const;

// ------------------------------------------------------------ Zod (ours)

const metric = z.enum(METRICS);

/** Bounds are generous but finite — every numeric input is range-checked. */
const filterShape = {
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  propertyType: z.string().optional(),
  condition: z.string().optional(),
  roomsMin: z.number().min(0).max(20).optional(),
  roomsMax: z.number().min(0).max(20).optional(),
  sizeMin: z.number().min(0).max(10_000).optional(),
  sizeMax: z.number().min(0).max(10_000).optional(),
  priceMin: z.number().min(0).max(1_000_000_000).optional(),
  priceMax: z.number().min(0).max(1_000_000_000).optional(),
  yearBuiltMin: z.number().int().min(1800).max(2100).optional(),
  yearBuiltMax: z.number().int().min(1800).max(2100).optional(),
  floorMin: z.number().int().min(-5).max(200).optional(),
  floorMax: z.number().int().min(-5).max(200).optional(),
  hasElevator: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  hasBalcony: z.boolean().optional(),
  hasSafeRoom: z.boolean().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
};

const filters = z.object(filterShape).strict();

export const TOOL_SCHEMAS = {
  get_statistics: z.object({
    filters: filters.optional(),
    metric: metric.optional(),
  }).strict(),

  get_time_series: z.object({
    filters: filters.optional(),
    metric: metric.optional(),
    // Accepted but not offered to the model: /browse and future callers may
    // force a resolution, the router may not. See the note in the tool
    // definition below.
    granularity: z.enum(["month", "quarter", "year"]).optional(),
  }).strict(),

  compare_locations: z.object({
    cities: z.array(z.string()).min(2).max(4),
    metric: metric.optional(),
    filters: filters.optional(),
  }).strict(),

  search_transactions: z.object({
    filters: filters.optional(),
    limit: z.number().int().min(1).max(MAX_RESULT_ROWS).optional(),
    sort: z.enum(SORTS).optional(),
  }).strict(),

  find_comparable_deals: z.object({
    city: z.string(),
    rooms: z.number().min(0).max(20).optional(),
    sizeSqm: z.number().min(1).max(10_000).optional(),
    propertyType: z.string().optional(),
    neighborhood: z.string().optional(),
    priceNis: z.number().min(0).max(1_000_000_000).optional(),
    limit: z.number().int().min(1).max(MAX_RESULT_ROWS).optional(),
  }).strict(),

  find_anomalies: z.object({
    filters: filters.optional(),
    limit: z.number().int().min(1).max(MAX_RESULT_ROWS).optional(),
  }).strict(),

  /** The honest exit. Used when the dataset cannot answer the question. */
  answer_not_supported: z.object({
    reason: z.string().max(400),
  }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as string[]).includes(name);
}

// --------------------------------------------- JSON Schema (sent to Claude)

type JsonSchema = Record<string, unknown>;

/**
 * Numeric bounds live in the description, not in the schema.
 *
 * `strict: true` rejects `minimum`/`maximum` on number and integer, and
 * `minItems` above 1 on arrays:
 *
 *   tools.0.custom: For 'number' type, properties maximum, minimum are not supported
 *
 * Sending them is a 400 on every request, which this app experienced as the
 * router silently falling back to the deterministic path — a correct answer
 * with worse prose, and no visible error. So the range is stated in prose
 * the model reads, and enforced by the Zod schemas above, which is where the
 * real guarantee lived anyway.
 */
function bounded(
  type: "number" | "integer",
  min: number,
  max: number,
  description?: string,
): JsonSchema {
  const range = `ערך בין ${min} ל-${max}`;
  return { type, description: description ? `${description}. ${range}` : range };
}

function filterJsonSchema(v: Snapshot["vocabulary"]): JsonSchema {
  return {
    type: "object",
    description: "מסננים. יש להשמיט כל שדה שלא נדרש במפורש.",
    properties: {
      // Enumerated from the snapshot: the model physically cannot invent one.
      city: { type: "string", enum: v.cities },
      /*
       * Neighbourhood is a plain string, not an enum, and this is a cost
       * decision made against a measurement.
       *
       * Hebrew tokenises at roughly two tokens per character, so the
       * 100-value neighbourhood list cost ~14,000 tokens each request once
       * repeated across six tools — more than half the entire cached
       * prefix. Cities stay enumerated because they are the filter that
       * actually decides an answer and there are only 18 of them.
       *
       * The grounding cost is small and bounded: an invented neighbourhood
       * matches no rows, and the engine already answers "no matching
       * transactions" rather than inventing any.
       */
      neighborhood: {
        type: "string",
        description: "שם שכונה מדויק כפי שהוא מופיע במאגר. יש לציין רק אם המשתמש ציין שכונה",
      },
      propertyType: { type: "string", enum: v.propertyTypes },
      condition: { type: "string", enum: v.conditions },
      roomsMin: bounded("number", 0, 20),
      roomsMax: bounded("number", 0, 20),
      sizeMin: bounded("number", 0, 10000, "שטח במ״ר"),
      sizeMax: bounded("number", 0, 10000, "שטח במ״ר"),
      priceMin: bounded("number", 0, 1_000_000_000, "מחיר בשקלים"),
      priceMax: bounded("number", 0, 1_000_000_000, "מחיר בשקלים"),
      yearBuiltMin: bounded("integer", 1800, 2100),
      yearBuiltMax: bounded("integer", 1800, 2100),
      floorMin: bounded("integer", -5, 200),
      floorMax: bounded("integer", -5, 200),
      hasElevator: { type: "boolean" },
      hasParking: { type: "boolean" },
      hasBalcony: { type: "boolean" },
      hasSafeRoom: { type: "boolean" },
      dateFrom: { type: "string", description: "yyyy-mm-dd" },
      dateTo: { type: "string", description: "yyyy-mm-dd" },
    },
    additionalProperties: false,
  };
}

const METRIC_SCHEMA = {
  type: "string",
  enum: METRICS,
  description: "price_per_sqm הוא ברירת המחדל לניתוח מחירים",
};

/**
 * Builds the tool definitions for a given snapshot.
 *
 * Rebuilt per snapshot version rather than hardcoded, so an admin upload that
 * introduces a new city immediately widens what the model may ask for — and
 * removing a city immediately narrows it.
 */
export function buildToolDefinitions(snapshot: Snapshot) {
  const v = snapshot.vocabulary;
  const f = filterJsonSchema(v);

  const tool = (name: ToolName, description: string, properties: JsonSchema, required: string[] = []) => ({
    name,
    description,
    // No `strict: true` — see the note above. additionalProperties:false is
    // still declared so the schema documents the closed shape, and Zod's
    // .strict() rejects anything extra server-side.
    input_schema: { type: "object", properties, required, additionalProperties: false },
  });

  return [
    tool("get_statistics",
      "סטטיסטיקה על קבוצת עסקאות: ספירה, חציון, ממוצע, אחוזונים, מינימום ומקסימום. " +
      "מתאים לשאלות כמו 'כמה עסקאות של 4 חדרים יש ברמת גן' או 'מה המחיר החציוני בחיפה'.",
      { filters: f, metric: METRIC_SCHEMA }),

    tool("get_time_series",
      "מגמה לאורך זמן — איך מדד השתנה לפי חודש או רבעון. " +
      "מתאים לשאלות כמו 'איך השתנה המחיר למ\"ר ברמת גן'.",
      { filters: f, metric: METRIC_SCHEMA }),

    tool("compare_locations",
      "השוואה בין שתיים עד ארבע ערים לפי מדד אחד. " +
      "מתאים לשאלות כמו 'תשווה בין רמת גן לגבעתיים'.",
      {
        cities: {
          type: "array",
          items: { type: "string", enum: v.cities },
          description: "שתיים עד ארבע ערים להשוואה",
        },
        metric: METRIC_SCHEMA,
        filters: f,
      },
      ["cities"]),

    tool("search_transactions",
      "רשימת עסקאות בודדות התואמות סינון. מתאים ל'הראה לי עסקאות של...'.",
      {
        filters: f,
        limit: bounded("integer", 1, MAX_RESULT_ROWS, "כמה עסקאות להחזיר"),
        sort: { type: "string", enum: SORTS },
      }),

    tool("find_comparable_deals",
      "עסקאות דומות לנכס שהמשתמש מתאר. יש למלא את כל מאפייני הנכס שהמשתמש ציין. " +
      "מתאים ל'מצא עסקאות דומות לדירת 4 חדרים, 100 מ\"ר ברמת גן'.",
      {
        city: { type: "string", enum: v.cities },
        rooms: bounded("number", 0, 20),
        sizeSqm: bounded("number", 1, 10000, "שטח הנכס במ״ר"),
        propertyType: { type: "string", enum: v.propertyTypes },
        neighborhood: { type: "string", description: "שכונה, רק אם המשתמש ציין" },
        priceNis: bounded("number", 0, 1_000_000_000, "המחיר שהמשתמש ציין לנכס שלו, אם ציין"),
        limit: bounded("integer", 1, MAX_RESULT_ROWS, "כמה עסקאות להחזיר"),
      },
      ["city"]),

    tool("find_anomalies",
      "עסקאות חריגות סטטיסטית מול קבוצת השוואה. מתאים ל'מצא עסקאות חריגות'.",
      { filters: f, limit: bounded("integer", 1, MAX_RESULT_ROWS, "כמה עסקאות להחזיר") }),

    tool("answer_not_supported",
      "יש לבחור בכלי הזה כאשר המאגר אינו יכול לענות על השאלה — למשל שאלות על " +
      "תחזיות עתידיות, איכות חיים, בתי ספר, רעש, תשואה, המלצות השקעה, או כל מידע " +
      "שאינו עסקאות נדל\"ן שבוצעו. עדיף לבחור בכלי הזה מאשר לענות תשובה שאינה נתמכת.",
      { reason: { type: "string", description: "במשפט אחד בעברית: מה חסר במאגר כדי לענות" } },
      ["reason"]),
  ];
}
