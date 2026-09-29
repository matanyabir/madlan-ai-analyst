/** Numeric parsing. 56 prices in the CSV carry thousands separators. */

export interface NumberParse {
  value: number | null;
  /** True when separators had to be stripped — worth logging. */
  hadSeparators: boolean;
  /** True when the cell was non-empty but could not be parsed at all. */
  unparseable: boolean;
}

export function parseNumber(raw: string | undefined | null): NumberParse {
  if (raw == null) return { value: null, hadSeparators: false, unparseable: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, hadSeparators: false, unparseable: false };

  const hadSeparators = trimmed.includes(",");
  // Strip thousands separators and any currency symbol, keep sign and decimal point.
  const cleaned = trimmed.replace(/[,\s₪]/g, "");
  const value = Number(cleaned);

  if (!Number.isFinite(value)) {
    return { value: null, hadSeparators, unparseable: true };
  }
  return { value, hadSeparators, unparseable: false };
}

/**
 * Room counts appear both as "4" and as "4 חדרים" — 19 spellings for 10 values.
 */
export function parseRooms(raw: string | undefined | null): {
  value: number | null;
  suffixStripped: boolean;
} {
  if (raw == null) return { value: null, suffixStripped: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, suffixStripped: false };

  const withoutSuffix = trimmed.replace(/\s*חדרים?\s*$/u, "").trim();
  const suffixStripped = withoutSuffix !== trimmed;
  const value = Number(withoutSuffix.replace(/,/g, ""));

  return {
    value: Number.isFinite(value) && value > 0 ? value : null,
    suffixStripped,
  };
}

/**
 * Plausibility bounds for Israeli residential sales, used to quarantine rows
 * rather than to correct them.
 *
 * The observed clean range is ₪492k–₪44M and ₪9,334–₪145,283 per m². These
 * bounds sit outside that with margin, so they catch only genuine nonsense:
 * D100317 lists a 132 m² flat at ₪18,000 (₪136/m²) with a stated
 * price_per_sqm of 0.
 */
export const PRICE_FLOOR_NIS = 100_000;
export const PRICE_PER_SQM_FLOOR = 3_000;
export const PRICE_PER_SQM_CEILING = 200_000;

export function isImplausiblePrice(price: number, sizeSqm: number | null): boolean {
  if (price < PRICE_FLOOR_NIS) return true;
  if (sizeSqm != null && sizeSqm > 0) {
    const perSqm = price / sizeSqm;
    if (perSqm < PRICE_PER_SQM_FLOOR || perSqm > PRICE_PER_SQM_CEILING) return true;
  }
  return false;
}

/** Deviation above which a stated price_per_sqm is treated as conflicting. */
export const PPS_CONFLICT_THRESHOLD = 0.02;
