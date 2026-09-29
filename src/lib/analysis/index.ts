import type { Deal, Snapshot } from "@/lib/types";
import { monthKey, quarterKey } from "@/lib/normalize/dates";
import { applyFilters, dateRangeOf, type DealFilter } from "./filters";
import { median, mean, percentile, round } from "./stats";
import {
  rankComparables, toDealCard, MIN_COMPARABLES, type SubjectProperty,
} from "./comparables";
import { findAnomalies, MIN_PEERS } from "./anomalies";
import { ANOMALY_THRESHOLD } from "./stats";
import type {
  AnalysisResult, Evidence, Granularity, MetricCard, SeriesPoint,
} from "./types";

export * from "./types";
export * from "./filters";
export * from "./stats";
export * from "./comparables";
export * from "./anomalies";

/** Hard ceiling on rows returned to the client and to the model. */
export const MAX_RESULT_ROWS = 50;

/** Below this many transactions an answer is flagged as a small sample. */
export const SMALL_SAMPLE = 10;

export type MetricName = "price_per_sqm" | "price" | "size" | "count";

const METRIC_META: Record<MetricName, { label: string; unit: MetricCard["unit"]; definition: string }> = {
  price_per_sqm: {
    label: "מחיר למ״ר",
    unit: "nis_per_sqm",
    definition: "חציון המחיר למ״ר, מחושב כמחיר העסקה חלקי השטח",
  },
  price: { label: "מחיר עסקה", unit: "nis", definition: "חציון מחיר העסקה" },
  size: { label: "שטח", unit: "sqm", definition: "חציון שטח הנכס במ״ר" },
  count: { label: "מספר עסקאות", unit: "count", definition: "ספירת עסקאות" },
};

function metricValue(deal: Deal, metric: MetricName): number | null {
  switch (metric) {
    case "price_per_sqm": return deal.pricePerSqm;
    case "price": return deal.priceNis;
    case "size": return deal.sizeSqm;
    case "count": return 1;
  }
}

function buildEvidence(
  snapshot: Snapshot,
  deals: Deal[],
  descriptions: { label: string; value: string }[],
  exclusions: { reason: string; count: number }[],
  metric?: { name: string; definition: string },
  notes: string[] = [],
): Evidence {
  const allNotes = [...notes];

  // A correct number from a tiny sample is still a weak basis for a claim.
  // Say so on the answer itself rather than leaving the reader to notice the
  // count in the evidence panel.
  if (deals.length > 0 && deals.length < SMALL_SAMPLE) {
    allNotes.push(
      `מדגם קטן — ${deals.length} עסקאות בלבד. המספרים מדויקים אך אינם בהכרח מייצגים`,
    );
  }

  const monthOnly = deals.filter((d) => d.datePrecision === "month").length;
  if (monthOnly) {
    allNotes.push(`${monthOnly} עסקאות מדווחות ברמת חודש בלבד ללא יום מדויק`);
  }
  if (snapshot.counts.conflictRowsHeldOut) {
    allNotes.push(
      `${snapshot.counts.conflictGroups} עסקאות דווחו ביותר מגרסה אחת ולא נכללות בחישובים`,
    );
  }
  return {
    transactionCount: deals.length,
    dateRange: dateRangeOf(deals),
    filters: descriptions,
    metric,
    exclusions: exclusions.filter((e) => e.count > 0),
    snapshotVersion: snapshot.version,
    notes: allNotes,
  };
}

function insufficient(
  snapshot: Snapshot, title: string, message: string,
  descriptions: { label: string; value: string }[], count: number,
): AnalysisResult {
  return {
    type: "insufficient",
    title,
    message,
    evidence: buildEvidence(snapshot, [], descriptions, [], undefined,
      count > 0 ? [`נמצאו ${count} עסקאות בלבד`] : []),
  };
}

// ---------------------------------------------------------------- statistics

export function getStatistics(
  snapshot: Snapshot, filters: DealFilter, metric: MetricName = "price_per_sqm",
): AnalysisResult {
  const { deals, exclusions, descriptions } = applyFilters(snapshot.deals, filters);
  if (!deals.length) {
    return insufficient(snapshot, "אין נתונים",
      "לא נמצאו עסקאות במאגר התואמות את הסינון המבוקש.", descriptions, 0);
  }

  const meta = METRIC_META[metric];
  const values = deals.map((d) => metricValue(d, metric)).filter((v): v is number => v != null);
  const metrics: MetricCard[] = [];

  /*
   * The first card is rendered as the headline, so it must answer the
   * question that was asked. Leading with the transaction count turned
   * "what is the average price in רמת גן?" into a large "27" with the price
   * demoted to a supporting card — the right number, presented as the
   * answer to a different question.
   */
  if (metric === "count" || !values.length) {
    metrics.push({ label: "מספר עסקאות", value: deals.length, unit: "count" });
  } else {
    metrics.push({
      label: `חציון ${meta.label}`,
      value: round(median(values)),
      unit: meta.unit,
      hint: "חציון, לא ממוצע — עמיד יותר לעסקאות קיצון",
    });
    metrics.push({ label: `ממוצע ${meta.label}`, value: round(mean(values)), unit: meta.unit });

    /*
     * Show the complementary price view alongside. Someone asking about
     * price usually wants both the headline figure and the per-m² figure,
     * and both are already computed — withholding one would be arbitrary.
     */
    const companion: MetricName | null =
      metric === "price" ? "price_per_sqm" : metric === "price_per_sqm" ? "price" : null;
    if (companion) {
      const companionValues = deals
        .map((d) => metricValue(d, companion))
        .filter((v): v is number => v != null);
      if (companionValues.length) {
        metrics.push({
          label: `חציון ${METRIC_META[companion].label}`,
          value: round(median(companionValues)),
          unit: METRIC_META[companion].unit,
        });
      }
    }

    metrics.push(
      { label: "מספר עסקאות", value: deals.length, unit: "count" },
      { label: "אחוזון 25", value: round(percentile(values, 0.25)), unit: meta.unit },
      { label: "אחוזון 75", value: round(percentile(values, 0.75)), unit: meta.unit },
      { label: "הנמוך ביותר", value: round(Math.min(...values)), unit: meta.unit },
      { label: "הגבוה ביותר", value: round(Math.max(...values)), unit: meta.unit },
    );
  }

  const where = filters.city ? ` ב${filters.city}` : "";
  return {
    type: "statistics",
    title: metric === "count" ? `מספר עסקאות${where}` : `${meta.label}${where}`,
    metrics,
    evidence: buildEvidence(snapshot, deals, descriptions, exclusions,
      { name: meta.label, definition: meta.definition }),
  };
}

// --------------------------------------------------------------- time series

/** Below this many deals a period is too thin to anchor a claim. */
const MIN_PER_PERIOD = 3;

const GRANULARITIES: Granularity[] = ["month", "quarter", "year"];

function bucketKeyFor(iso: string, g: Granularity): string {
  if (g === "month") return monthKey(iso);
  if (g === "quarter") return quarterKey(iso);
  return iso.slice(0, 4);
}

const GRANULARITY_LABEL: Record<Granularity, string> = {
  month: "חודש", quarter: "רבעון", year: "שנה",
};

export function getTimeSeries(
  snapshot: Snapshot, filters: DealFilter, metric: MetricName = "price_per_sqm",
  granularity?: Granularity,
): AnalysisResult {
  const { deals, exclusions, descriptions } = applyFilters(snapshot.deals, filters);
  const dated = deals.filter((d) => d.dealDate);

  if (dated.length < 6) {
    return insufficient(snapshot, "אין מספיק נתונים למגמה",
      "אין מספיק עסקאות במאגר כדי להציג מגמה אמינה לאורך זמן.", descriptions, dated.length);
  }

  const bucket = (g: Granularity) => {
    const map = new Map<string, number[]>();
    for (const d of dated) {
      const v = metricValue(d, metric);
      if (v == null) continue;
      const key = bucketKeyFor(d.dealDate!, g);
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    }
    return map;
  };

  /**
   * Widen the bucket until most periods carry enough deals to mean something.
   *
   * 27 deals spread over five years gives roughly two per quarter, and a
   * "median" of two is not a median. Escalating month -> quarter -> year is
   * how the data decides its own resolution instead of the caller guessing.
   */
  let chosen: Granularity = granularity ?? "month";
  if (!granularity) {
    for (const g of GRANULARITIES) {
      const sizes = [...bucket(g).values()].map((v) => v.length);
      const thin = sizes.filter((n) => n < MIN_PER_PERIOD).length;
      chosen = g;
      if (thin <= sizes.length / 2) break;
    }
  }

  const buckets = bucket(chosen);
  const points: SeriesPoint[] = [...buckets.entries()]
    .map(([period, values]) => ({
      period,
      value: metric === "count" ? values.length : round(median(values)),
      n: values.length,
      sparse: values.length < MIN_PER_PERIOD,
    }))
    // Periods with no transactions are absent, never interpolated.
    .sort((a, b) => a.period.localeCompare(b.period));

  /**
   * The endpoint change is the single most quotable number here, and the
   * easiest to get wrong: computing it from a first and last period of one
   * deal each turns two transactions into a five-year trend. It is therefore
   * measured between the first and last periods that actually clear the
   * threshold, and is null when fewer than two do.
   */
  const solid = points.filter((p) => !p.sparse);
  const change =
    solid.length >= 2 && solid[0].value > 0
      ? {
          fromPeriod: solid[0].period,
          toPeriod: solid[solid.length - 1].period,
          percent: round((solid[solid.length - 1].value / solid[0].value - 1) * 100, 1),
          fromN: solid[0].n,
          toN: solid[solid.length - 1].n,
        }
      : null;

  const sparseCount = points.length - solid.length;
  const notes: string[] = [`הנתונים מקובצים לפי ${GRANULARITY_LABEL[chosen]}`];
  if (chosen !== "month") {
    notes.push(`נבחרה רזולוציה של ${GRANULARITY_LABEL[chosen]} כי ברזולוציה צפופה יותר אין מספיק עסקאות לתקופה`);
  }
  if (sparseCount) {
    notes.push(
      `${sparseCount} תקופות מבוססות על פחות מ-${MIN_PER_PERIOD} עסקאות ומסומנות בגרף. ` +
      `חישוב השינוי מתעלם מהן`,
    );
  }
  if (!change) {
    notes.push("אין מספיק תקופות עם מספר עסקאות מספק כדי לחשב שינוי לאורך התקופה");
  }

  const meta = METRIC_META[metric];
  const where = filters.city ? ` ב${filters.city}` : "";

  return {
    type: "timeSeries",
    title: `${meta.label} לאורך זמן${where}`,
    metricLabel: metric === "count" ? meta.label : `חציון ${meta.label}`,
    unit: meta.unit,
    points,
    granularity: chosen,
    change,
    evidence: buildEvidence(snapshot, dated, descriptions, exclusions,
      { name: meta.label, definition: `${meta.definition}. תקופות ללא עסקאות אינן מוצגות` },
      notes),
  };
}

// ---------------------------------------------------------------- comparison

export function compareLocations(
  snapshot: Snapshot, cities: string[], metric: MetricName = "price_per_sqm",
  baseFilters: DealFilter = {},
): AnalysisResult {
  const items: { label: string; value: number; n: number }[] = [];
  const allDeals: Deal[] = [];
  const exclusions: { reason: string; count: number }[] = [];
  const thin: string[] = [];

  for (const city of cities) {
    const { deals, exclusions: ex } = applyFilters(snapshot.deals, { ...baseFilters, city });
    exclusions.push(...ex);
    allDeals.push(...deals);
    const values = deals.map((d) => metricValue(d, metric)).filter((v): v is number => v != null);
    if (values.length < MIN_COMPARABLES) {
      thin.push(city);
      continue;
    }
    items.push({
      label: city,
      value: metric === "count" ? deals.length : round(median(values)),
      n: deals.length,
    });
  }

  if (items.length < 2) {
    return insufficient(snapshot, "לא ניתן להשוות",
      `אין מספיק עסקאות במאגר ב${thin.join(" וב")} כדי להציג השוואה אמינה.`,
      cities.map((c) => ({ label: "עיר", value: c })), items.length);
  }

  const meta = METRIC_META[metric];
  items.sort((a, b) => b.value - a.value);

  return {
    type: "comparison",
    title: `${meta.label}: ${items.map((i) => i.label).join(" מול ")}`,
    metricLabel: metric === "count" ? meta.label : `חציון ${meta.label}`,
    unit: meta.unit,
    items,
    evidence: buildEvidence(snapshot, allDeals,
      cities.map((c) => ({ label: "עיר", value: c })), exclusions,
      { name: meta.label, definition: meta.definition },
      thin.length ? [`${thin.join(", ")} הושמטו — פחות מ-${MIN_COMPARABLES} עסקאות`] : []),
  };
}

// ----------------------------------------------------------------- deal list

export function searchTransactions(
  snapshot: Snapshot, filters: DealFilter, limit = 20,
  sort: "recent" | "price_desc" | "price_asc" = "recent",
): AnalysisResult {
  const { deals, exclusions, descriptions } = applyFilters(snapshot.deals, filters);
  if (!deals.length) {
    return insufficient(snapshot, "לא נמצאו עסקאות",
      "לא נמצאו עסקאות במאגר התואמות את הסינון המבוקש.", descriptions, 0);
  }

  const sorted = [...deals].sort((a, b) => {
    if (sort === "price_desc") return (b.priceNis ?? 0) - (a.priceNis ?? 0);
    if (sort === "price_asc") return (a.priceNis ?? 0) - (b.priceNis ?? 0);
    return (b.dealDate ?? "").localeCompare(a.dealDate ?? "");
  });

  const capped = Math.min(limit, MAX_RESULT_ROWS);
  return {
    type: "dealList",
    title: `עסקאות תואמות${filters.city ? ` ב${filters.city}` : ""}`,
    deals: sorted.slice(0, capped).map((d) => toDealCard(d)),
    evidence: buildEvidence(snapshot, deals, descriptions, exclusions, undefined,
      deals.length > capped ? [`מוצגות ${capped} מתוך ${deals.length} עסקאות`] : []),
  };
}

// --------------------------------------------------------------- comparables

export function findComparableDeals(
  snapshot: Snapshot, subject: SubjectProperty, limit = 8,
): AnalysisResult {
  const scored = rankComparables(subject, snapshot.deals, Math.min(limit, MAX_RESULT_ROWS));

  const descriptions = [
    { label: "עיר", value: subject.city },
    ...(subject.rooms != null ? [{ label: "חדרים", value: String(subject.rooms) }] : []),
    ...(subject.sizeSqm != null ? [{ label: "שטח", value: `${subject.sizeSqm} מ״ר` }] : []),
    ...(subject.propertyType ? [{ label: "סוג נכס", value: subject.propertyType }] : []),
  ];

  if (scored.length < MIN_COMPARABLES) {
    return insufficient(snapshot, "אין מספיק עסקאות דומות",
      "אין מספיק עסקאות דומות במאגר כדי להציג השוואה אמינה.", descriptions, scored.length);
  }

  const notes = [
    "הדמיון מחושב לפי שטח (30%), חדרים (25%), עדכניות (15%), סוג נכס (15%) ושכונה (15%). העיר היא תנאי סף",
  ];
  if (subject.priceNis != null) {
    const medianPps = median(
      scored.map((s) => s.deal.pricePerSqm).filter((v): v is number => v != null),
    );
    if (subject.sizeSqm) {
      const subjectPps = subject.priceNis / subject.sizeSqm;
      const diff = ((subjectPps / medianPps - 1) * 100);
      notes.push(
        `המחיר שציינת הוא ₪${Math.round(subjectPps).toLocaleString("he-IL")} למ״ר — ` +
        `${Math.abs(diff).toFixed(0)}% ${diff >= 0 ? "מעל" : "מתחת"} לחציון העסקאות הדומות שנמצאו`,
      );
    }
  }

  return {
    type: "dealList",
    title: `עסקאות דומות ב${subject.city}`,
    deals: scored.map((s) =>
      toDealCard(s.deal, {
        similarity: {
          score: round(s.score, 3),
          factors: s.factors.map((f) => ({ label: f.label, contribution: round(f.contribution, 3) })),
        },
      }),
    ),
    evidence: buildEvidence(snapshot, scored.map((s) => s.deal), descriptions, [],
      { name: "ציון דמיון", definition: "ציון משוקלל בין 0 ל-1" }, notes),
  };
}

// ----------------------------------------------------------------- anomalies

export function getAnomalies(
  snapshot: Snapshot, filters: DealFilter, limit = 10,
): AnalysisResult {
  const { deals, exclusions, descriptions } = applyFilters(snapshot.deals, filters);
  const { hits, unjudged, peerGroupsUsed } = findAnomalies(deals, Math.min(limit, MAX_RESULT_ROWS));

  if (!hits.length) {
    return {
      type: "text",
      title: "לא נמצאו עסקאות חריגות",
      body:
        `נבדקו ${deals.length} עסקאות ב-${peerGroupsUsed} קבוצות השוואה. ` +
        `לא נמצאה עסקה שסוטה מעל הסף שנקבע מחציון קבוצת ההשוואה שלה.`,
      evidence: buildEvidence(snapshot, deals, descriptions, [...exclusions, ...unjudged],
        { name: "חריגות", definition: anomalyDefinition() }),
    };
  }

  return {
    type: "dealList",
    title: "עסקאות חריגות סטטיסטית",
    deals: hits.map((h) =>
      toDealCard(h.deal, {
        anomaly: {
          modifiedZ: round(h.modifiedZ, 2),
          peerMedian: round(h.peerMedian),
          peerCount: h.peerCount,
          direction: h.direction,
        },
      }),
    ),
    evidence: buildEvidence(snapshot, deals, descriptions, [...exclusions, ...unjudged],
      { name: "חריגות", definition: anomalyDefinition() },
      ["חריגה משמעה שונות סטטיסטית מקבוצת ההשוואה — לא שגיאה בנתונים ולא עסקה שגויה"]),
  };
}

export function anomalyDefinition(): string {
  return (
    `עסקה מסומנת כחריגה כאשר המחיר למ״ר שלה רחוק לפחות ${ANOMALY_THRESHOLD} ` +
    `סטיות חציוניות מוחלטות (MAD) מחציון קבוצת ההשוואה — אותה עיר ואותו מספר חדרים, ` +
    `בקבוצה של ${MIN_PEERS} עסקאות לפחות`
  );
}
