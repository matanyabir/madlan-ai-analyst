import type { Deal } from "@/lib/types";
import type { Exclusion, FilterDescription } from "./types";

/**
 * The filter vocabulary. This is also the shape the LLM is allowed to emit —
 * every field is a closed enum or a bounded number, validated server-side.
 */
export interface DealFilter {
  city?: string;
  neighborhood?: string;
  propertyType?: string;
  condition?: string;
  source?: string;
  roomsMin?: number;
  roomsMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  priceMin?: number;
  priceMax?: number;
  yearBuiltMin?: number;
  yearBuiltMax?: number;
  floorMin?: number;
  floorMax?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface FilterOutcome {
  deals: Deal[];
  exclusions: Exclusion[];
  descriptions: FilterDescription[];
}

const ROOM_LABEL = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Applies a filter to the analysable population, recording why rows dropped
 * out so the evidence panel can show it.
 *
 * Note the tri-state handling: `hasParking: false` matches only rows that
 * explicitly say no, never rows where the field is missing. 20 rows have an
 * unknown has_parking and they must not be silently counted as "no".
 */
export function applyFilters(all: Deal[], f: DealFilter): FilterOutcome {
  const descriptions: FilterDescription[] = [];
  const exclusions: Exclusion[] = [];
  let deals = all.filter((d) => d.isAnalyzable);

  const unanalysable = all.length - deals.length;
  if (unanalysable > 0) {
    exclusions.push({ reason: "עסקאות שהוצאו בשלב ניקוי הנתונים", count: unanalysable });
  }

  const step = (label: string, value: string, predicate: (d: Deal) => boolean) => {
    deals = deals.filter(predicate);
    descriptions.push({ label, value });
  };

  if (f.city) step("עיר", f.city, (d) => d.city === f.city);
  if (f.neighborhood) step("שכונה", f.neighborhood, (d) => d.neighborhood === f.neighborhood);
  if (f.propertyType) step("סוג נכס", f.propertyType, (d) => d.propertyType === f.propertyType);
  if (f.condition) step("מצב הנכס", f.condition, (d) => d.condition === f.condition);
  if (f.source) step("מקור הדיווח", f.source, (d) => d.source === f.source);

  if (f.roomsMin != null || f.roomsMax != null) {
    const lo = f.roomsMin ?? -Infinity;
    const hi = f.roomsMax ?? Infinity;
    const missing = deals.filter((d) => d.rooms == null).length;
    if (missing) exclusions.push({ reason: "ללא מספר חדרים", count: missing });
    step(
      "חדרים",
      lo === hi ? ROOM_LABEL(lo) : `${lo === -Infinity ? "" : ROOM_LABEL(lo)}–${hi === Infinity ? "" : ROOM_LABEL(hi)}`,
      (d) => d.rooms != null && d.rooms >= lo && d.rooms <= hi,
    );
  }

  if (f.sizeMin != null || f.sizeMax != null) {
    const lo = f.sizeMin ?? -Infinity;
    const hi = f.sizeMax ?? Infinity;
    step(
      "שטח",
      `${lo === -Infinity ? "" : lo}–${hi === Infinity ? "" : hi} מ״ר`,
      (d) => d.sizeSqm != null && d.sizeSqm >= lo && d.sizeSqm <= hi,
    );
  }

  if (f.priceMin != null || f.priceMax != null) {
    const lo = f.priceMin ?? -Infinity;
    const hi = f.priceMax ?? Infinity;
    step(
      "מחיר",
      `${lo === -Infinity ? "" : `₪${lo.toLocaleString("he-IL")}`}–${hi === Infinity ? "" : `₪${hi.toLocaleString("he-IL")}`}`,
      (d) => d.priceNis != null && d.priceNis >= lo && d.priceNis <= hi,
    );
  }

  if (f.yearBuiltMin != null || f.yearBuiltMax != null) {
    const lo = f.yearBuiltMin ?? -Infinity;
    const hi = f.yearBuiltMax ?? Infinity;
    const missing = deals.filter((d) => d.yearBuilt == null).length;
    if (missing) exclusions.push({ reason: "ללא שנת בנייה", count: missing });
    step(
      "שנת בנייה",
      `${lo === -Infinity ? "" : lo}–${hi === Infinity ? "" : hi}`,
      (d) => d.yearBuilt != null && d.yearBuilt >= lo && d.yearBuilt <= hi,
    );
  }

  if (f.floorMin != null || f.floorMax != null) {
    const lo = f.floorMin ?? -Infinity;
    const hi = f.floorMax ?? Infinity;
    const missing = deals.filter((d) => d.floor == null).length;
    if (missing) exclusions.push({ reason: "ללא קומה", count: missing });
    step(
      "קומה",
      `${lo === -Infinity ? "" : lo}–${hi === Infinity ? "" : hi}`,
      (d) => d.floor != null && d.floor >= lo && d.floor <= hi,
    );
  }

  // Tri-state: an explicit false must not match a missing value.
  const flags: [keyof DealFilter, keyof Deal, string][] = [
    ["hasElevator", "hasElevator", "מעלית"],
    ["hasParking", "hasParking", "חניה"],
    ["hasBalcony", "hasBalcony", "מרפסת"],
    ["hasSafeRoom", "hasSafeRoom", 'ממ"ד'],
  ];
  for (const [filterKey, dealKey, label] of flags) {
    const want = f[filterKey] as boolean | undefined;
    if (want == null) continue;
    const unknown = deals.filter((d) => d[dealKey] == null).length;
    if (unknown) exclusions.push({ reason: `ללא מידע על ${label}`, count: unknown });
    step(label, want ? "יש" : "אין", (d) => d[dealKey] === want);
  }

  if (f.dateFrom) step("מתאריך", f.dateFrom, (d) => !!d.dealDate && d.dealDate >= f.dateFrom!);
  if (f.dateTo) step("עד תאריך", f.dateTo, (d) => !!d.dealDate && d.dealDate <= f.dateTo!);

  return { deals, exclusions, descriptions };
}

/** Observed date span of a set of deals. */
export function dateRangeOf(deals: Deal[]): { min: string; max: string } | null {
  const dates = deals.map((d) => d.dealDate).filter((d): d is string => !!d).sort();
  return dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null;
}
