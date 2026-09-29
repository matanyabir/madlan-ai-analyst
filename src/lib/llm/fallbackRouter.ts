import type { Snapshot } from "@/lib/types";
import type { ToolCall } from "./execute";

/**
 * The no-LLM path.
 *
 * Matches the question against the snapshot's *own* vocabulary plus a small
 * set of Hebrew number patterns. It is not as good as the model at unusual
 * phrasings — that is the honest trade — but it answers the common shapes
 * correctly and, crucially, it cannot invent anything: every city it can
 * name came out of the data.
 *
 * Used when there is no API key, when Claude times out, when it returns no
 * tool call, and when its arguments fail validation. The answer is flagged
 * `degraded` so the UI can say the explanation is a template.
 */

const HEB_DIGITS: Record<string, number> = {
  אחד: 1, אחת: 1, שתיים: 2, שתי: 2, שניים: 2, שלוש: 3, שלושה: 3,
  ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6,
};

/**
 * Every extractor is bounded by what the tool schemas accept. A question
 * reading "999 חדרים" must yield no room filter rather than an argument our
 * own validator would reject — the fallback has no second chance behind it.
 */
function bounded(n: number | null, min: number, max: number): number | null {
  return n != null && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** "4 חדרים", "ארבעה חדרים", "4.5 חד'" */
function extractRooms(q: string): number | null {
  const numeric = /(\d+(?:\.\d+)?)\s*(?:חדרים|חדר|חד['׳]?)/u.exec(q);
  if (numeric) return bounded(Number(numeric[1]), 0, 20);
  const words = new RegExp(`(${Object.keys(HEB_DIGITS).join("|")})\\s*(?:חדרים|חדר)`, "u").exec(q);
  if (words) return HEB_DIGITS[words[1]];
  return null;
}

/** '100 מ"ר', "100 מטר", "100 מ׳׳ר" */
function extractSize(q: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:מ["״'׳]{0,2}ר|מטר(?:\s*רבוע)?)/u.exec(q);
  return m ? bounded(Number(m[1]), 1, 10_000) : null;
}

/** "3.9 מיליון", "₪3,900,000", "2 מיליון שקל" */
function extractPrice(q: string): number | null {
  const millions = /(\d+(?:\.\d+)?)\s*מיליון/u.exec(q);
  if (millions) return bounded(Math.round(Number(millions[1]) * 1_000_000), 0, 1_000_000_000);
  const plain = /₪\s*([\d,]{6,})/u.exec(q) ?? /([\d,]{7,})\s*(?:ש["״]?ח|שקל)/u.exec(q);
  if (plain) return bounded(Number(plain[1].replace(/,/g, "")), 0, 1_000_000_000);
  return null;
}

/** Longest-match first, so "מודיעין-מכבים-רעות" wins over a shorter prefix. */
function extractCities(q: string, cities: string[]): string[] {
  const found: string[] = [];
  for (const city of [...cities].sort((a, b) => b.length - a.length)) {
    if (q.includes(city) && !found.some((f) => f.includes(city))) found.push(city);
  }
  // Common shorthands the canonical list does not contain verbatim.
  if (!found.length) {
    if (/ת["״]א|תל[- ]אביב/u.test(q) && cities.includes("תל אביב-יפו")) found.push("תל אביב-יפו");
    if (/ב["״]ש|באר[- ]שבע/u.test(q) && cities.includes("באר שבע")) found.push("באר שבע");
    if (/מודיעין/u.test(q) && cities.includes("מודיעין-מכבים-רעות")) found.push("מודיעין-מכבים-רעות");
  }
  return found;
}

function extractPropertyType(q: string, types: string[]): string | undefined {
  return [...types].sort((a, b) => b.length - a.length).find((t) => q.includes(t));
}

const UNSUPPORTED = /בית ספר|בתי ספר|תחבורה|רעש|שקט|איכות חיים|תשואה|כדאי|להשקיע|השקעה|יעלה|ירד בעתיד|תחזית|צפוי|המלצה|מומלץ|שכונה טובה|פארק|גנים/u;

/**
 * A question naming a year after the last transaction in the data is asking
 * for a forecast. Derived from the snapshot rather than hardcoded, so it
 * stays correct when a newer CSV is uploaded.
 */
function asksAboutTheFuture(q: string, snapshot: Snapshot): boolean {
  const lastYear = Number(snapshot.dateRange?.max.slice(0, 4) ?? "9999");
  for (const m of q.matchAll(/\b(19|20)\d{2}\b/g)) {
    if (Number(m[0]) > lastYear) return true;
  }
  return false;
}
const ANOMALY = /חריג|יוצא דופן|מוזר|לא הגיוני|אנומלי/u;
const COMPARABLE = /דומ(?:ה|ות|ים)|השוו(?:ה|את)\s+ל?נכס|כמו ה?דירה|עסקאות דומות/u;
const COMPARE = /תשווה|להשוות|השווה|מול|לעומת|יותר יקר|יותר זול/u;
const TREND = /השתנה|מגמה|לאורך זמן|לאורך השנים|התפתחות|עלה|ירד|היסטורי|לפי חודש|לפי שנה/u;
/**
 * "כמה" is ambiguous in Hebrew: "how many" *and* "how much".
 *
 * "כמה עסקאות יש ברמת גן"   -> how many, a count
 * "כמה עולה דירת גן ממוצעת" -> how much, a price
 *
 * Matching "כמה" alone turned every price question into a transaction
 * count. PRICE is therefore tested first, and COUNT requires something
 * countable rather than the bare interrogative.
 */
const PRICE = /עולה|עולות|עולים|עלות|מחיר|כמה שווה|יקר|זול|תקציב|ממוצע|חציון/u;
const COUNT = /כמה\s+\S*\s*(עסקאות|דירות|נכסים|בתים)|מספר\s+ה?(עסקאות|דירות|נכסים)|ספירה|כמה יש/u;

/**
 * An explicit per-square-metre request overrides the default deal price.
 *
 * No \b anchors here: Hebrew letters are not \w in JavaScript regex, so a
 * word boundary after ר never matches the way it reads.
 */
const PER_SQM = /למ["״׳']{0,2}ר|למטר|לכל מטר|מטר רבוע|מ["״]ר/u;
const LIST = /הראה|תראה|רשימה|אילו עסקאות|תן לי עסקאות/u;

/**
 * Always returns a call — worst case, get_statistics over whatever was
 * recognised. Never returns null, because "no route" would be a dead end.
 */
export function fallbackRoute(snapshot: Snapshot, question: string): ToolCall {
  const q = question.trim();
  const v = snapshot.vocabulary;

  const cities = extractCities(q, v.cities);
  const rooms = extractRooms(q);
  const size = extractSize(q);
  const price = extractPrice(q);
  const propertyType = extractPropertyType(q, v.propertyTypes);

  const filters: Record<string, unknown> = {};
  if (cities[0]) filters.city = cities[0];
  if (rooms != null) { filters.roomsMin = rooms; filters.roomsMax = rooms; }
  if (propertyType) filters.propertyType = propertyType;

  if (UNSUPPORTED.test(q) || asksAboutTheFuture(q, snapshot)) {
    return {
      name: "answer_not_supported",
      input: {
        reason:
          "המאגר מכיל אך ורק עסקאות נדל\"ן שבוצעו — מיקום, מאפייני הנכס, תאריך ומחיר. " +
          "אין בו מידע על סביבת המגורים, על שירותים בשכונה, ואין בו בסיס לתחזיות או להמלצות.",
      },
    };
  }

  if (ANOMALY.test(q)) return { name: "find_anomalies", input: { filters, limit: 10 } };

  // A described property — needs a size or a price alongside the rooms to be
  // a "find me something like this" question rather than a filter.
  if (COMPARABLE.test(q) || (cities[0] && rooms != null && (size != null || price != null))) {
    if (cities[0]) {
      return {
        name: "find_comparable_deals",
        input: {
          city: cities[0],
          ...(rooms != null ? { rooms } : {}),
          ...(size != null ? { sizeSqm: size } : {}),
          ...(price != null ? { priceNis: price } : {}),
          ...(propertyType ? { propertyType } : {}),
          limit: 8,
        },
      };
    }
  }

  if (cities.length >= 2 && COMPARE.test(q)) {
    return {
      name: "compare_locations",
      input: { cities: cities.slice(0, 4), metric: "price_per_sqm" },
    };
  }

  if (TREND.test(q)) {
    // Trends normalise for size, so per-m² is the right default here even
    // when the question just says "מחיר".
    return { name: "get_time_series", input: { filters, metric: "price_per_sqm" } };
  }

  // Price before count, because "כמה עולה" matches both.
  if (PRICE.test(q)) {
    return {
      name: "get_statistics",
      input: { filters, metric: PER_SQM.test(q) ? "price_per_sqm" : "price" },
    };
  }

  if (COUNT.test(q)) {
    return { name: "get_statistics", input: { filters, metric: "count" } };
  }

  if (LIST.test(q)) {
    return { name: "search_transactions", input: { filters, limit: 20, sort: "recent" } };
  }

  return { name: "get_statistics", input: { filters, metric: "price_per_sqm" } };
}
