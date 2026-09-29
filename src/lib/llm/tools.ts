import { z } from "zod";
import type { Snapshot } from "@/lib/types";
import { MAX_RESULT_ROWS } from "@/lib/analysis";

/**
 * The six operations the model is allowed to invoke.
 *
 * Two independent guards, deliberately:
 *
 *   1. The JSON Schema sent to Claude uses `strict: true` and enumerates
 *      cities, property types and conditions from the *snapshot's own
 *      vocabulary*. The model cannot name a city that is not in the data.
 *
 *   2. The Zod schemas below re-validate every argument server-side, because
 *      `strict: true` is the model's promise and this is ours. A malformed
 *      or out-of-range argument is rejected, not clamped.
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
    granularity: z.enum(["month", "quarter"]).optional(),
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

function filterJsonSchema(v: Snapshot["vocabulary"]): JsonSchema {
  const allNeighborhoods = [
    ...new Set(Object.values(v.neighborhoodsByCity).flat()),
  ];
  return {
    type: "object",
    description: "מסננים. יש להשמיט כל שדה שלא נדרש במפורש.",
    properties: {
      // Enumerated from the snapshot: the model physically cannot invent one.
      city: { type: "string", enum: v.cities },
      neighborhood: { type: "string", enum: allNeighborhoods },
      propertyType: { type: "string", enum: v.propertyTypes },
      condition: { type: "string", enum: v.conditions },
      roomsMin: { type: "number", minimum: 0, maximum: 20 },
      roomsMax: { type: "number", minimum: 0, maximum: 20 },
      sizeMin: { type: "number", minimum: 0, maximum: 10000 },
      sizeMax: { type: "number", minimum: 0, maximum: 10000 },
      priceMin: { type: "number", minimum: 0 },
      priceMax: { type: "number", minimum: 0 },
      yearBuiltMin: { type: "integer", minimum: 1800, maximum: 2100 },
      yearBuiltMax: { type: "integer", minimum: 1800, maximum: 2100 },
      floorMin: { type: "integer", minimum: -5, maximum: 200 },
      floorMax: { type: "integer", minimum: -5, maximum: 200 },
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
    strict: true,
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
      {
        filters: f,
        metric: METRIC_SCHEMA,
        granularity: { type: "string", enum: ["month", "quarter"] },
      }),

    tool("compare_locations",
      "השוואה בין שתיים עד ארבע ערים לפי מדד אחד. " +
      "מתאים לשאלות כמו 'תשווה בין רמת גן לגבעתיים'.",
      {
        cities: { type: "array", items: { type: "string", enum: v.cities }, minItems: 2, maxItems: 4 },
        metric: METRIC_SCHEMA,
        filters: f,
      },
      ["cities"]),

    tool("search_transactions",
      "רשימת עסקאות בודדות התואמות סינון. מתאים ל'הראה לי עסקאות של...'.",
      {
        filters: f,
        limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
        sort: { type: "string", enum: SORTS },
      }),

    tool("find_comparable_deals",
      "עסקאות דומות לנכס שהמשתמש מתאר. יש למלא את כל מאפייני הנכס שהמשתמש ציין. " +
      "מתאים ל'מצא עסקאות דומות לדירת 4 חדרים, 100 מ\"ר ברמת גן'.",
      {
        city: { type: "string", enum: v.cities },
        rooms: { type: "number", minimum: 0, maximum: 20 },
        sizeSqm: { type: "number", minimum: 1, maximum: 10000 },
        propertyType: { type: "string", enum: v.propertyTypes },
        neighborhood: { type: "string", enum: [...new Set(Object.values(v.neighborhoodsByCity).flat())] },
        priceNis: { type: "number", minimum: 0, description: "המחיר שהמשתמש ציין לנכס שלו, אם ציין" },
        limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
      },
      ["city"]),

    tool("find_anomalies",
      "עסקאות חריגות סטטיסטית מול קבוצת השוואה. מתאים ל'מצא עסקאות חריגות'.",
      { filters: f, limit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS } }),

    tool("answer_not_supported",
      "יש לבחור בכלי הזה כאשר המאגר אינו יכול לענות על השאלה — למשל שאלות על " +
      "תחזיות עתידיות, איכות חיים, בתי ספר, רעש, תשואה, המלצות השקעה, או כל מידע " +
      "שאינו עסקאות נדל\"ן שבוצעו. עדיף לבחור בכלי הזה מאשר לענות תשובה שאינה נתמכת.",
      { reason: { type: "string", description: "במשפט אחד בעברית: מה חסר במאגר כדי לענות" } },
      ["reason"]),
  ];
}
