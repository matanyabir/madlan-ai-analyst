import type { Deal } from "@/lib/types";

/** One filter, described in Hebrew for the evidence panel. */
export interface FilterDescription {
  label: string;
  value: string;
}

/** Rows a tool had to drop, and why — shown to the user, never hidden. */
export interface Exclusion {
  reason: string;
  count: number;
}

/**
 * Attached to every analytical answer. This is what makes the product
 * auditable: the user can always see how many transactions an answer rests
 * on, over what period, under what filters, and what was left out.
 */
export interface Evidence {
  transactionCount: number;
  dateRange: { min: string; max: string } | null;
  filters: FilterDescription[];
  metric?: { name: string; definition: string };
  exclusions: Exclusion[];
  snapshotVersion: string;
  notes: string[];
}

export interface MetricCard {
  label: string;
  value: number;
  unit: "nis" | "nis_per_sqm" | "count" | "sqm" | "rooms" | "percent" | "year";
  hint?: string;
}

export interface SeriesPoint {
  period: string;
  value: number;
  n: number;
  /** True when this period rests on too few deals to carry a claim. */
  sparse: boolean;
}

export interface DealCard {
  key: string;
  dealId: string;
  city: string | null;
  neighborhood: string | null;
  street: string | null;
  propertyType: string | null;
  rooms: number | null;
  sizeSqm: number | null;
  floor: number | null;
  priceNis: number | null;
  pricePerSqm: number | null;
  dealDate: string | null;
  datePrecision: "day" | "month" | null;
  source: string | null;
  /** Populated by find_comparable_deals. */
  similarity?: { score: number; factors: { label: string; contribution: number }[] };
  /** Populated by find_anomalies. */
  anomaly?: { modifiedZ: number; peerMedian: number; peerCount: number; direction: "high" | "low" };
}

export type Granularity = "month" | "quarter" | "year";

export type AnalysisResult =
  | { type: "statistics"; title: string; metrics: MetricCard[]; evidence: Evidence }
  | {
      type: "timeSeries"; title: string; metricLabel: string;
      unit: MetricCard["unit"]; points: SeriesPoint[];
      granularity: Granularity; evidence: Evidence;
      /** Endpoint change, only when both ends rest on enough deals. */
      change: { fromPeriod: string; toPeriod: string; percent: number; fromN: number; toN: number } | null;
    }
  | {
      type: "comparison"; title: string; metricLabel: string;
      unit: MetricCard["unit"];
      items: { label: string; value: number; n: number }[];
      evidence: Evidence;
    }
  | { type: "dealList"; title: string; deals: DealCard[]; evidence: Evidence }
  | {
      type: "propertyComparison"; title: string;
      subject: { label: string; rows: { label: string; value: string }[] };
      others: { label: string; rows: { label: string; value: string }[] }[];
      evidence: Evidence;
    }
  | { type: "text"; title: string; body: string; evidence: Evidence }
  | { type: "insufficient"; title: string; message: string; evidence: Evidence };

export type { Deal };
