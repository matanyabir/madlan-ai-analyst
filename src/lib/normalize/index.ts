import type { Deal, IngestIssue, QuarantineReason } from "@/lib/types";
import { cleanText, wasWhitespaceDirty } from "./text";
import { parseBoolean, isUnrecognisedBoolean } from "./booleans";
import {
  parseNumber,
  parseRooms,
  isImplausiblePrice,
  PPS_CONFLICT_THRESHOLD,
} from "./numbers";
import { parseDealDate } from "./dates";
import { canonicalCity } from "./aliases";

export * from "./text";
export * from "./booleans";
export * from "./numbers";
export * from "./dates";
export * from "./aliases";

export type RawRow = Record<string, string>;

export interface NormalizedRow {
  deal: Deal;
  issues: IngestIssue[];
}

const TEXT_FIELDS: [csv: string, field: keyof Deal][] = [
  ["neighborhood", "neighborhood"],
  ["street", "street"],
  ["property_type", "propertyType"],
  ["condition", "condition"],
  ["source", "source"],
];

const BOOLEAN_FIELDS: [csv: string, field: keyof Deal][] = [
  ["has_elevator", "hasElevator"],
  ["has_parking", "hasParking"],
  ["has_balcony", "hasBalcony"],
  ["has_safe_room", "hasSafeRoom"],
];

/**
 * Normalizes one CSV row into a Deal, recording every transformation and
 * every problem as an IngestIssue.
 *
 * Deliberately does NOT handle duplicates or assign conflict groups — that
 * needs the whole file and lives in lib/ingest/dedupe.ts.
 */
export function normalizeRow(raw: RawRow, rowNumber: number): NormalizedRow {
  const issues: IngestIssue[] = [];
  const dealId = cleanText(raw.deal_id) ?? `ROW_${rowNumber}`;

  const issue = (
    field: string,
    type: IngestIssue["type"],
    severity: IngestIssue["severity"],
    rawValue: string,
    resolvedValue: string | null,
    note?: string,
  ) => {
    issues.push({
      rowNumber,
      dealId,
      field,
      type,
      severity,
      rawValue,
      resolvedValue,
      resolver: "deterministic",
      ...(note ? { note } : {}),
    });
  };

  // ---------------------------------------------------------------- city
  const city = canonicalCity(raw.city);
  if (city.unresolved) {
    issue(
      "city",
      "city_unresolved",
      "error",
      raw.city ?? "",
      null,
      "לא נמצאה עיר מוכרת התואמת לערך הזה",
    );
  } else if (city.aliasApplied) {
    issue("city", "city_alias_applied", "info", raw.city ?? "", city.canonical);
  } else if (wasWhitespaceDirty(raw.city)) {
    issue("city", "whitespace_trimmed", "info", raw.city ?? "", city.canonical);
  }

  // ------------------------------------------------------------ text fields
  const text: Partial<Record<keyof Deal, string | null>> = {};
  for (const [csvKey, field] of TEXT_FIELDS) {
    const cleaned = cleanText(raw[csvKey]);
    text[field] = cleaned;
    if (wasWhitespaceDirty(raw[csvKey])) {
      issue(csvKey, "whitespace_trimmed", "info", raw[csvKey] ?? "", cleaned);
    }
    if (cleaned == null && csvKey !== "source") {
      issue(csvKey, "missing_value", "warning", "", null);
    }
  }

  // ----------------------------------------------------------------- rooms
  const rooms = parseRooms(raw.rooms);
  if (rooms.suffixStripped) {
    issue("rooms", "rooms_suffix_stripped", "info", raw.rooms ?? "", String(rooms.value));
  }
  if (rooms.value == null && cleanText(raw.rooms) != null) {
    issue("rooms", "unparseable_number", "error", raw.rooms ?? "", null);
  }

  // --------------------------------------------------------- plain numerics
  const size = parseNumber(raw.size_sqm);
  const floor = parseNumber(raw.floor);
  const totalFloors = parseNumber(raw.total_floors);
  const yearBuilt = parseNumber(raw.year_built);

  for (const [csvKey, parsed] of [
    ["size_sqm", size],
    ["floor", floor],
    ["total_floors", totalFloors],
    ["year_built", yearBuilt],
  ] as const) {
    if (parsed.unparseable) {
      issue(csvKey, "unparseable_number", "error", raw[csvKey] ?? "", null);
    } else if (parsed.value == null) {
      issue(csvKey, "missing_value", "warning", "", null);
    }
  }

  // -------------------------------------------------------------- booleans
  const booleans: Partial<Record<keyof Deal, boolean | null>> = {};
  for (const [csvKey, field] of BOOLEAN_FIELDS) {
    booleans[field] = parseBoolean(raw[csvKey]);
    if (isUnrecognisedBoolean(raw[csvKey])) {
      issue(csvKey, "unparseable_number", "error", raw[csvKey] ?? "", null);
    } else if (booleans[field] == null) {
      issue(csvKey, "missing_value", "warning", "", null);
    }
  }

  // ------------------------------------------------------------------ date
  const date = parseDealDate(raw.deal_date);
  if (date.unparseable) {
    issue("deal_date", "date_unparseable", "error", raw.deal_date ?? "", null);
  } else if (date.missingDay) {
    issue(
      "deal_date",
      "date_missing_day",
      "warning",
      raw.deal_date ?? "",
      date.iso,
      "התאריך במקור חסר יום. נקבע ה-1 בחודש, והעסקה משתתפת רק בניתוחים חודשיים",
    );
  } else if (date.reformatted) {
    issue("deal_date", "date_reformatted", "info", raw.deal_date ?? "", date.iso);
  } else if (date.iso == null) {
    issue("deal_date", "missing_value", "warning", "", null);
  }

  // ---------------------------------------------------------------- pricing
  const priceParse = parseNumber(raw.price_nis);
  const ppsParse = parseNumber(raw.price_per_sqm);

  if (priceParse.hadSeparators) {
    issue(
      "price_nis",
      "price_separators_stripped",
      "info",
      raw.price_nis ?? "",
      String(priceParse.value),
    );
  }

  let priceNis = priceParse.value;
  let priceDerived = false;

  // 12 rows have no price but do have size and a stated price-per-m2.
  if (priceNis == null && size.value != null && ppsParse.value != null && ppsParse.value > 0) {
    priceNis = Math.round(size.value * ppsParse.value);
    priceDerived = true;
    issue(
      "price_nis",
      "price_derived",
      "warning",
      "",
      String(priceNis),
      "המחיר שוחזר מתוך שטח × מחיר למ״ר",
    );
  } else if (priceNis == null) {
    issue("price_nis", "price_missing", "error", raw.price_nis ?? "", null);
  } else if (priceNis === 0) {
    issue("price_nis", "price_zero", "error", raw.price_nis ?? "", null);
  }

  // price_per_sqm is always recomputed; the stated value is kept as raw.
  let pricePerSqm: number | null = null;
  if (priceNis != null && priceNis > 0 && size.value != null && size.value > 0) {
    pricePerSqm = priceNis / size.value;

    if (ppsParse.value != null && ppsParse.value > 0 && !priceDerived) {
      const ratio = ppsParse.value / pricePerSqm;
      if (Math.abs(ratio - 1) > PPS_CONFLICT_THRESHOLD) {
        issue(
          "price_per_sqm",
          "price_per_sqm_conflict",
          "warning",
          raw.price_per_sqm ?? "",
          String(Math.round(pricePerSqm)),
          `הערך במקור סוטה ב-${((ratio - 1) * 100).toFixed(0)}% מהחישוב מחיר÷שטח. נעשה שימוש בערך המחושב`,
        );
      }
    }
  }

  // ------------------------------------------------------------- quarantine
  const quarantineReasons: QuarantineReason[] = [];
  if (city.canonical == null) quarantineReasons.push("unresolved_city");
  if (priceNis == null) quarantineReasons.push("no_price");
  else if (priceNis === 0) quarantineReasons.push("zero_price");
  else if (isImplausiblePrice(priceNis, size.value)) {
    quarantineReasons.push("implausible_price");
    issue(
      "price_nis",
      "price_implausible",
      "error",
      raw.price_nis ?? "",
      null,
      size.value
        ? `₪${Math.round(priceNis / size.value).toLocaleString("he-IL")} למ״ר — מחוץ לטווח סביר, העסקה הוצאה מהניתוחים`
        : "מחיר מחוץ לטווח סביר, העסקה הוצאה מהניתוחים",
    );
  }
  if (size.value == null || size.value <= 0) quarantineReasons.push("no_size");

  const deal: Deal = {
    key: dealId,
    dealId,
    city: city.canonical,
    neighborhood: text.neighborhood ?? null,
    street: text.street ?? null,
    propertyType: text.propertyType ?? null,
    condition: text.condition ?? null,
    rooms: rooms.value,
    sizeSqm: size.value,
    floor: floor.value,
    totalFloors: totalFloors.value,
    yearBuilt: yearBuilt.value,
    hasElevator: booleans.hasElevator ?? null,
    hasParking: booleans.hasParking ?? null,
    hasBalcony: booleans.hasBalcony ?? null,
    hasSafeRoom: booleans.hasSafeRoom ?? null,
    dealDate: date.iso,
    datePrecision: date.precision,
    priceNis,
    pricePerSqm,
    pricePerSqmRaw: ppsParse.value,
    priceDerived,
    source: text.source ?? null,
    isAnalyzable: quarantineReasons.length === 0,
    quarantineReasons,
    conflictGroup: null,
    raw,
    rowNumber,
  };

  return { deal, issues };
}
