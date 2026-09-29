import { cleanText } from "./text";

/**
 * City alias table: 29 raw spellings in the CSV for 18 real municipalities.
 *
 * Keys are whitespace-cleaned raw values; values are the canonical Hebrew
 * name. Hebrew is canonical because the product is Hebrew-first — a user
 * asking about תל אביב must also see the four rows spelled "Tel Aviv-Yafo".
 *
 * Only `מודיעין -> מודיעין-מכבים-רעות` is a judgement call rather than a
 * spelling fix. It is argued from the data: the neighborhoods כרמים, מוריה,
 * בוכמן, נופים and הפרחים each appear under all three spellings, and a
 * neighborhood cannot be in two cities. See docs/DATA_QUALITY.md §1.
 */
export const CITY_ALIASES: Record<string, string> = {
  // Tel Aviv-Yafo
  'ת"א': "תל אביב-יפו",
  "תל אביב": "תל אביב-יפו",
  "תל אביב יפו": "תל אביב-יפו",
  "תל אביב-יפו": "תל אביב-יפו",
  "Tel Aviv-Yafo": "תל אביב-יפו",
  "Tel Aviv": "תל אביב-יפו",

  // Jerusalem
  ירושלים: "ירושלים",
  Jerusalem: "ירושלים",

  // Be'er Sheva
  "באר שבע": "באר שבע",
  "באר-שבע": "באר שבע",
  'ב"ש': "באר שבע",

  // Beit Shemesh
  "בית שמש": "בית שמש",
  "בית-שמש": "בית שמש",

  // Modi'in-Maccabim-Re'ut
  מודיעין: "מודיעין-מכבים-רעות",
  "מודיעין מכבים רעות": "מודיעין-מכבים-רעות",
  "מודיעין-מכבים-רעות": "מודיעין-מכבים-רעות",

  // Single-spelling cities, listed so the canonical set is explicit and the
  // AI canonicalization step has a complete whitelist to choose from.
  חולון: "חולון",
  נתניה: "נתניה",
  "ראשון לציון": "ראשון לציון",
  "פתח תקווה": "פתח תקווה",
  "כפר סבא": "כפר סבא",
  רעננה: "רעננה",
  "רמת גן": "רמת גן",
  רחובות: "רחובות",
  הרצליה: "הרצליה",
  גבעתיים: "גבעתיים",
  "בת ים": "בת ים",
  אשדוד: "אשדוד",
  חיפה: "חיפה",
};

/** The closed set of canonical city names. */
export const CANONICAL_CITIES: string[] = [
  ...new Set(Object.values(CITY_ALIASES)),
].sort((a, b) => a.localeCompare(b, "he"));

export interface AliasResult {
  canonical: string | null;
  /** True when the raw value differed from the canonical one. */
  aliasApplied: boolean;
  /** True when the value is non-empty but absent from the table. */
  unresolved: boolean;
}

export function canonicalCity(raw: string | undefined | null): AliasResult {
  const cleaned = cleanText(raw);
  if (cleaned == null) return { canonical: null, aliasApplied: false, unresolved: false };

  const hit = CITY_ALIASES[cleaned];
  if (hit) {
    return { canonical: hit, aliasApplied: hit !== cleaned, unresolved: false };
  }
  return { canonical: null, aliasApplied: false, unresolved: true };
}

/**
 * Property types and conditions need no alias table — after whitespace
 * cleaning the CSV has exactly six and five distinct values respectively.
 * They are listed so the tool schemas can constrain the model to real values
 * and the AI step has a whitelist.
 */
export const CANONICAL_PROPERTY_TYPES = [
  "דירה",
  "דירת גן",
  "דירת גג",
  "דופלקס",
  "פנטהאוז",
  "בית פרטי",
];

export const CANONICAL_CONDITIONS = [
  "חדש מקבלן",
  "משופץ",
  "שמור",
  "במצב טוב",
  "דורש שיפוץ",
];

export const CANONICAL_SOURCES = ["רשות המסים", "מתווך", "בעל נכס"];
