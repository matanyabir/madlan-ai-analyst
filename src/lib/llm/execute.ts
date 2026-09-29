import type { Snapshot } from "@/lib/types";
import {
  getStatistics, getTimeSeries, compareLocations, searchTransactions,
  findComparableDeals, getAnomalies, type AnalysisResult, type DealFilter,
} from "@/lib/analysis";
import { TOOL_SCHEMAS, isToolName, type ToolName } from "./tools";

export interface ToolCall {
  name: string;
  input: unknown;
}

export type ExecutionOutcome =
  | { ok: true; call: { name: ToolName; input: unknown }; result: AnalysisResult }
  | { ok: false; error: string; detail?: string };

/**
 * Validates a tool call against our own Zod schemas and executes it.
 *
 * Nothing the model produces reaches the analysis engine unvalidated, and
 * nothing here is clamped or coerced: an out-of-range argument is a rejected
 * call, which the caller turns into a fallback rather than a wrong answer.
 */
export function executeToolCall(snapshot: Snapshot, call: ToolCall): ExecutionOutcome {
  if (!isToolName(call.name)) {
    return { ok: false, error: "unknown_tool", detail: call.name };
  }

  const parsed = TOOL_SCHEMAS[call.name].safeParse(call.input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_arguments",
      detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  const args = parsed.data;
  const done = (result: AnalysisResult): ExecutionOutcome => ({
    ok: true, call: { name: call.name as ToolName, input: args }, result,
  });

  switch (call.name) {
    case "get_statistics": {
      const a = args as { filters?: DealFilter; metric?: "price_per_sqm" | "price" | "size" | "count" };
      return done(getStatistics(snapshot, a.filters ?? {}, a.metric ?? "price_per_sqm"));
    }
    case "get_time_series": {
      const a = args as {
        filters?: DealFilter;
        metric?: "price_per_sqm" | "price" | "size" | "count";
        granularity?: "month" | "quarter";
      };
      return done(getTimeSeries(snapshot, a.filters ?? {}, a.metric ?? "price_per_sqm", a.granularity));
    }
    case "compare_locations": {
      const a = args as {
        cities: string[];
        metric?: "price_per_sqm" | "price" | "size" | "count";
        filters?: DealFilter;
      };
      return done(compareLocations(snapshot, a.cities, a.metric ?? "price_per_sqm", a.filters ?? {}));
    }
    case "search_transactions": {
      const a = args as { filters?: DealFilter; limit?: number; sort?: "recent" | "price_desc" | "price_asc" };
      return done(searchTransactions(snapshot, a.filters ?? {}, a.limit ?? 20, a.sort ?? "recent"));
    }
    case "find_comparable_deals": {
      const a = args as {
        city: string; rooms?: number; sizeSqm?: number; propertyType?: string;
        neighborhood?: string; priceNis?: number; limit?: number;
      };
      return done(findComparableDeals(snapshot, {
        city: a.city, rooms: a.rooms, sizeSqm: a.sizeSqm,
        propertyType: a.propertyType, neighborhood: a.neighborhood, priceNis: a.priceNis,
      }, a.limit ?? 8));
    }
    case "find_anomalies": {
      const a = args as { filters?: DealFilter; limit?: number };
      return done(getAnomalies(snapshot, a.filters ?? {}, a.limit ?? 10));
    }
    case "answer_not_supported": {
      const a = args as { reason: string };
      return done({
        type: "text",
        title: "המאגר לא מכיל את המידע הזה",
        body: a.reason,
        evidence: {
          transactionCount: 0,
          dateRange: snapshot.dateRange,
          filters: [],
          exclusions: [],
          snapshotVersion: snapshot.version,
          notes: [
            "המאגר מכיל עסקאות נדל\"ן שבוצעו בלבד: עיר, שכונה, רחוב, סוג נכס, " +
            "חדרים, שטח, קומה, שנת בנייה, מצב, מעלית, חניה, מרפסת, ממ\"ד, תאריך, מחיר ומקור הדיווח",
          ],
        },
      });
    }
  }
}
