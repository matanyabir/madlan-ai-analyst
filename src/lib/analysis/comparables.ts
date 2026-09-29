import type { Deal } from "@/lib/types";
import { monthsBetween } from "@/lib/normalize/dates";
import type { DealCard } from "./types";

/**
 * Comparable-transaction scoring.
 *
 * Deliberately simple and fully explainable: five weighted factors summing to
 * 1.0, each returning 0–1, with the city as a hard filter rather than a
 * weight. The model never decides which deals are similar — it only extracts
 * the subject property. This function decides, and returns its own working so
 * the UI can show why each deal was chosen.
 */
export interface SubjectProperty {
  city: string;
  rooms?: number;
  sizeSqm?: number;
  propertyType?: string;
  neighborhood?: string;
  priceNis?: number;
}

export const WEIGHTS = {
  neighborhood: 0.15,
  rooms: 0.25,
  area: 0.3,
  recency: 0.15,
  propertyType: 0.15,
} as const;

/** Deals within half a room score above zero; two rooms apart scores zero. */
const ROOM_TOLERANCE = 2;
/** Area similarity falls to zero at ±50% of the subject's size. */
const AREA_TOLERANCE_RATIO = 0.5;
/** Recency weight halves every 12 months. */
const RECENCY_HALF_LIFE_MONTHS = 12;

export interface ScoredDeal {
  deal: Deal;
  score: number;
  factors: { label: string; contribution: number }[];
}

export function scoreDeal(subject: SubjectProperty, deal: Deal, newestIso: string): ScoredDeal {
  const factors: { label: string; contribution: number }[] = [];
  let score = 0;

  // Neighborhood — only scored when the subject names one.
  if (subject.neighborhood) {
    const hit = deal.neighborhood === subject.neighborhood ? 1 : 0;
    score += hit * WEIGHTS.neighborhood;
    factors.push({ label: "אותה שכונה", contribution: hit * WEIGHTS.neighborhood });
  }

  if (subject.rooms != null && deal.rooms != null) {
    const sim = 1 - Math.min(1, Math.abs(deal.rooms - subject.rooms) / ROOM_TOLERANCE);
    score += sim * WEIGHTS.rooms;
    factors.push({ label: "מספר חדרים", contribution: sim * WEIGHTS.rooms });
  }

  if (subject.sizeSqm != null && deal.sizeSqm != null) {
    const tolerance = subject.sizeSqm * AREA_TOLERANCE_RATIO;
    const sim = 1 - Math.min(1, Math.abs(deal.sizeSqm - subject.sizeSqm) / tolerance);
    score += sim * WEIGHTS.area;
    factors.push({ label: "שטח", contribution: sim * WEIGHTS.area });
  }

  if (deal.dealDate) {
    const months = Math.max(0, monthsBetween(deal.dealDate, newestIso));
    const sim = 0.5 ** (months / RECENCY_HALF_LIFE_MONTHS);
    score += sim * WEIGHTS.recency;
    factors.push({ label: "עדכניות העסקה", contribution: sim * WEIGHTS.recency });
  }

  if (subject.propertyType) {
    const hit = deal.propertyType === subject.propertyType ? 1 : 0;
    score += hit * WEIGHTS.propertyType;
    factors.push({ label: "סוג נכס זהה", contribution: hit * WEIGHTS.propertyType });
  }

  return { deal, score, factors };
}

/** Below this many matches the result is reported as insufficient, not thin. */
export const MIN_COMPARABLES = 3;

export function rankComparables(
  subject: SubjectProperty,
  pool: Deal[],
  limit: number,
): ScoredDeal[] {
  // City is a hard filter: a flat in חיפה is not a comparable for one in רמת גן
  // at any score.
  const candidates = pool.filter((d) => d.isAnalyzable && d.city === subject.city);
  if (!candidates.length) return [];

  const newestIso = candidates
    .map((d) => d.dealDate)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)!;

  return candidates
    .map((d) => scoreDeal(subject, d, newestIso))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function toDealCard(deal: Deal, extra?: Partial<DealCard>): DealCard {
  return {
    key: deal.key,
    dealId: deal.dealId,
    city: deal.city,
    neighborhood: deal.neighborhood,
    street: deal.street,
    propertyType: deal.propertyType,
    rooms: deal.rooms,
    sizeSqm: deal.sizeSqm,
    floor: deal.floor,
    priceNis: deal.priceNis,
    pricePerSqm: deal.pricePerSqm == null ? null : Math.round(deal.pricePerSqm),
    dealDate: deal.dealDate,
    datePrecision: deal.datePrecision,
    source: deal.source,
    ...extra,
  };
}
