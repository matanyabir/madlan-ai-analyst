import { describe, it, expect } from "vitest";
import { cleanText, wasWhitespaceDirty } from "./text";
import { parseBoolean, isUnrecognisedBoolean } from "./booleans";
import { parseNumber, parseRooms, isImplausiblePrice } from "./numbers";
import { parseDealDate, monthKey, quarterKey, monthsBetween } from "./dates";
import { canonicalCity, CANONICAL_CITIES } from "./aliases";
import { normalizeRow } from "./index";

/**
 * Every input below is a real value taken from data/madlan_deals_sample.csv.
 * Inventing test fixtures for a dirty-data pipeline defeats the point.
 */

describe("cleanText", () => {
  it.each([
    ['"מרכז "', "מרכז ", "מרכז"],
    ["leading and trailing", "  מבצע קדש ", "מבצע קדש"],
    ["double trailing", "לוי אשכול  ", "לוי אשכול"],
    ["already clean", "רמת גן", "רמת גן"],
    ["quoted street with internal quote", 'הפלמ"ח', 'הפלמ"ח'],
  ])("%s", (_label, input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it("returns null for empty and whitespace-only", () => {
    expect(cleanText("")).toBeNull();
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it("collapses internal whitespace runs", () => {
    expect(cleanText("מרכז   העיר")).toBe("מרכז העיר");
  });

  it("flags only values that actually change", () => {
    expect(wasWhitespaceDirty("מרכז ")).toBe(true);
    expect(wasWhitespaceDirty("מרכז")).toBe(false);
    expect(wasWhitespaceDirty("")).toBe(false);
  });
});

describe("parseBoolean — all eight representations in the CSV", () => {
  it.each([
    ["כן", true], ["yes", true], ["TRUE", true], ["1", true],
    ["לא", false], ["no", false], ["FALSE", false], ["0", false],
  ])("%s -> %s", (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(parseBoolean(" True ")).toBe(true);
    expect(parseBoolean("NO")).toBe(false);
  });

  it("returns null for missing rather than false", () => {
    // 20 rows have an empty has_parking. Treating that as "no parking"
    // would silently corrupt every filtered count.
    expect(parseBoolean("")).toBeNull();
    expect(parseBoolean(undefined)).toBeNull();
  });

  it("distinguishes absent from unrecognised", () => {
    expect(isUnrecognisedBoolean("")).toBe(false);
    expect(isUnrecognisedBoolean("אולי")).toBe(true);
  });
});

describe("parseNumber", () => {
  it("strips thousands separators (56 rows in the CSV)", () => {
    expect(parseNumber("4,331,000")).toEqual({
      value: 4331000, hadSeparators: true, hadCurrencySymbol: false, unparseable: false,
    });
  });

  it("strips a shekel sign (12 rows in the CSV)", () => {
    // These were reported as "missing prices" by a parser that stripped only
    // commas. They are not missing. See docs/AI_LOG.md #5.
    expect(parseNumber("₪12,144,000")).toEqual({
      value: 12144000, hadSeparators: true, hadCurrencySymbol: true, unparseable: false,
    });
  });

  it("leaves plain integers alone", () => {
    expect(parseNumber("3054000").value).toBe(3054000);
    expect(parseNumber("3054000").hadSeparators).toBe(false);
  });

  it("distinguishes empty from unparseable", () => {
    expect(parseNumber("")).toEqual({
      value: null, hadSeparators: false, hadCurrencySymbol: false, unparseable: false,
    });
    expect(parseNumber("לא ידוע").unparseable).toBe(true);
  });

  it("keeps zero as zero, not null", () => {
    // D100251 has price_nis of 0. That is a defect to report, not a gap.
    expect(parseNumber("0").value).toBe(0);
  });
});

describe("parseRooms", () => {
  it.each([
    ["3", 3, false],
    ["3.5", 3.5, false],
    ["4 חדרים", 4, true],
    ["5.5 חדרים", 5.5, true],
    ["1 חדרים", 1, true],
  ])("%s -> %s", (input, value, suffixStripped) => {
    expect(parseRooms(input)).toEqual({ value, suffixStripped });
  });
});

describe("isImplausiblePrice", () => {
  it("rejects D100317 — a 132 m2 flat listed at ₪18,000", () => {
    expect(isImplausiblePrice(18_000, 132)).toBe(true);
  });

  it("accepts the genuine extremes of the dataset", () => {
    expect(isImplausiblePrice(492_000, 23)).toBe(false);   // cheapest real deal
    expect(isImplausiblePrice(44_000_000, 310)).toBe(false); // most expensive
    expect(isImplausiblePrice(38_500_000, 265)).toBe(false); // highest ₪/m2, 145k
  });
});

describe("parseDealDate — all four formats", () => {
  it("parses ISO without reformatting", () => {
    expect(parseDealDate("2025-09-07")).toMatchObject({
      iso: "2025-09-07", precision: "day", reformatted: false, missingDay: false,
    });
  });

  it("parses dd/mm/yyyy day-first", () => {
    expect(parseDealDate("15/06/2025")).toMatchObject({ iso: "2025-06-15", precision: "day" });
    // 26 > 12, so this can only be day-first.
    expect(parseDealDate("26/04/2026")).toMatchObject({ iso: "2026-04-26" });
  });

  it("parses dd.mm.yyyy day-first", () => {
    expect(parseDealDate("05.11.2021")).toMatchObject({ iso: "2021-11-05", precision: "day" });
    expect(parseDealDate("17.07.2026")).toMatchObject({ iso: "2026-07-17" });
  });

  it("parses 'Mon yyyy' to the 1st at month precision", () => {
    expect(parseDealDate("Aug 2025")).toMatchObject({
      iso: "2025-08-01", precision: "month", missingDay: true, reformatted: true,
    });
    expect(parseDealDate("Feb 2024").iso).toBe("2024-02-01");
    expect(parseDealDate("Dec 2024").iso).toBe("2024-12-01");
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(parseDealDate("31/02/2025").unparseable).toBe(true);
    expect(parseDealDate("2025-13-01").unparseable).toBe(true);
  });

  it("distinguishes empty from unparseable", () => {
    expect(parseDealDate("").unparseable).toBe(false);
    expect(parseDealDate("someday").unparseable).toBe(true);
  });
});

describe("date bucket helpers", () => {
  it("buckets by month and quarter", () => {
    expect(monthKey("2025-09-07")).toBe("2025-09");
    expect(quarterKey("2025-09-07")).toBe("2025-Q3");
    expect(quarterKey("2025-01-31")).toBe("2025-Q1");
    expect(quarterKey("2025-12-01")).toBe("2025-Q4");
  });

  it("counts whole months across a year boundary", () => {
    expect(monthsBetween("2024-10-15", "2025-09-07")).toBe(11);
    expect(monthsBetween("2025-09-07", "2025-09-30")).toBe(0);
  });
});

describe("canonicalCity", () => {
  it("collapses all five Tel Aviv spellings", () => {
    for (const raw of ['ת"א', "תל אביב", "תל אביב יפו", "תל אביב-יפו", "Tel Aviv-Yafo"]) {
      expect(canonicalCity(raw).canonical).toBe("תל אביב-יפו");
    }
  });

  it("collapses Be'er Sheva, Jerusalem and Beit Shemesh variants", () => {
    expect(canonicalCity('ב"ש').canonical).toBe("באר שבע");
    expect(canonicalCity("באר-שבע").canonical).toBe("באר שבע");
    expect(canonicalCity("Jerusalem").canonical).toBe("ירושלים");
    expect(canonicalCity("ירושלים ").canonical).toBe("ירושלים");
    expect(canonicalCity("בית-שמש").canonical).toBe("בית שמש");
  });

  it("merges the three Modi'in spellings", () => {
    // Argued from shared neighborhoods, see docs/DATA_QUALITY.md §1.
    for (const raw of ["מודיעין", "מודיעין מכבים רעות", "מודיעין-מכבים-רעות"]) {
      expect(canonicalCity(raw).canonical).toBe("מודיעין-מכבים-רעות");
    }
  });

  it("reports aliasApplied only when the value actually changed", () => {
    expect(canonicalCity("רמת גן").aliasApplied).toBe(false);
    expect(canonicalCity('ת"א').aliasApplied).toBe(true);
  });

  it("flags an unknown city as unresolved rather than guessing", () => {
    const r = canonicalCity("עיר שלא קיימת");
    expect(r.canonical).toBeNull();
    expect(r.unresolved).toBe(true);
  });

  it("covers every city in the CSV, collapsing 29 spellings to 18", () => {
    expect(CANONICAL_CITIES).toHaveLength(18);
    // No raw value may fall through to the AI step by accident.
    expect(CANONICAL_CITIES).toContain("תל אביב-יפו");
    expect(CANONICAL_CITIES).not.toContain("תל אביב");
  });
});

describe("normalizeRow", () => {
  const base: Record<string, string> = {
    deal_id: "D100350", city: "ראשון לציון", neighborhood: "נאות שקמה",
    street: "לוי אשכול", property_type: "בית פרטי", rooms: "3", size_sqm: "110",
    floor: "0", total_floors: "2", year_built: "1964", condition: "דורש שיפוץ",
    has_elevator: "FALSE", has_parking: "no", has_balcony: "כן", has_safe_room: "no",
    deal_date: "2025-09-07", price_nis: "3054000", price_per_sqm: "27764",
    source: "רשות המסים",
  };

  it("normalizes a clean row without raising issues", () => {
    const { deal, issues } = normalizeRow(base, 1);
    expect(deal.city).toBe("ראשון לציון");
    expect(deal.hasElevator).toBe(false);
    expect(deal.hasBalcony).toBe(true);
    expect(deal.floor).toBe(0);
    expect(deal.isAnalyzable).toBe(true);
    expect(issues).toHaveLength(0);
  });

  it("always recomputes pricePerSqm and preserves the stated value", () => {
    const { deal } = normalizeRow(base, 1);
    expect(deal.pricePerSqm).toBeCloseTo(3054000 / 110, 6);
    expect(deal.pricePerSqmRaw).toBe(27764);
  });

  it("logs a conflict when the stated price_per_sqm disagrees by >2%", () => {
    // D100178: ₪3,586,000 / 65 m2 = ₪55,169, but the CSV states ₪68,592.
    const { deal, issues } = normalizeRow(
      { ...base, deal_id: "D100178", size_sqm: "65", price_nis: "3586000", price_per_sqm: "68592" },
      2,
    );
    const conflict = issues.find((i) => i.type === "price_per_sqm_conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.severity).toBe("warning");
    expect(deal.pricePerSqm).toBeCloseTo(55169.23, 1);
    expect(deal.pricePerSqmRaw).toBe(68592);
    expect(deal.isAnalyzable).toBe(true); // a conflict is reported, not fatal
  });

  it("stays silent when the stated value agrees within 2%", () => {
    const { issues } = normalizeRow({ ...base, price_per_sqm: "27763" }, 3);
    expect(issues.filter((i) => i.type === "price_per_sqm_conflict")).toHaveLength(0);
  });

  it("logs the currency strip so it is visible in the admin log", () => {
    const { deal, issues } = normalizeRow(
      { ...base, deal_id: "D100468", price_nis: "₪12,144,000", size_sqm: "173" },
      11,
    );
    expect(deal.priceNis).toBe(12_144_000);
    expect(deal.priceDerived).toBe(false);
    expect(issues.some((i) => i.type === "price_currency_symbol_stripped")).toBe(true);
  });

  it("derives a missing price from size x stated price_per_sqm", () => {
    const { deal, issues } = normalizeRow(
      { ...base, deal_id: "D100468", price_nis: "", size_sqm: "100", price_per_sqm: "30000" },
      4,
    );
    expect(deal.priceNis).toBe(3_000_000);
    expect(deal.priceDerived).toBe(true);
    expect(deal.isAnalyzable).toBe(true);
    expect(issues.some((i) => i.type === "price_derived")).toBe(true);
  });

  it("quarantines a zero price", () => {
    const { deal, issues } = normalizeRow(
      { ...base, deal_id: "D100251", price_nis: "0", price_per_sqm: "0" },
      5,
    );
    expect(deal.isAnalyzable).toBe(false);
    expect(deal.quarantineReasons).toContain("zero_price");
    expect(issues.some((i) => i.type === "price_zero")).toBe(true);
  });

  it("quarantines the implausible ₪18,000 deal but keeps the row", () => {
    const { deal, issues } = normalizeRow(
      {
        ...base, deal_id: "D100317", city: "רחובות", rooms: "4.5",
        size_sqm: "132", price_nis: "18000", price_per_sqm: "0",
      },
      6,
    );
    expect(deal.isAnalyzable).toBe(false);
    expect(deal.quarantineReasons).toContain("implausible_price");
    expect(deal.raw.price_nis).toBe("18000"); // nothing is deleted
    expect(issues.some((i) => i.type === "price_implausible")).toBe(true);
  });

  it("quarantines an unresolvable city", () => {
    const { deal } = normalizeRow({ ...base, city: "עיר מומצאת" }, 7);
    expect(deal.isAnalyzable).toBe(false);
    expect(deal.quarantineReasons).toContain("unresolved_city");
  });

  it("logs the alias, the stripped suffix and the reformatted date together", () => {
    const { deal, issues } = normalizeRow(
      { ...base, city: 'ת"א', rooms: "4 חדרים", deal_date: "15/06/2025", price_nis: "2,101,000" },
      8,
    );
    expect(deal.city).toBe("תל אביב-יפו");
    expect(deal.rooms).toBe(4);
    expect(deal.dealDate).toBe("2025-06-15");
    expect(deal.priceNis).toBe(2_101_000);

    const types = issues.map((i) => i.type);
    expect(types).toContain("city_alias_applied");
    expect(types).toContain("rooms_suffix_stripped");
    expect(types).toContain("date_reformatted");
    expect(types).toContain("price_separators_stripped");
  });

  it("marks a day-less date as month precision and warns", () => {
    const { deal, issues } = normalizeRow({ ...base, deal_date: "Aug 2025" }, 9);
    expect(deal.dealDate).toBe("2025-08-01");
    expect(deal.datePrecision).toBe("month");
    const i = issues.find((x) => x.type === "date_missing_day");
    expect(i?.severity).toBe("warning");
  });

  it("keeps the raw row verbatim for traceability", () => {
    const dirty = { ...base, neighborhood: "  מרכז ", city: "ירושלים " };
    const { deal } = normalizeRow(dirty, 10);
    expect(deal.neighborhood).toBe("מרכז");
    expect(deal.raw.neighborhood).toBe("  מרכז ");
    expect(deal.raw.city).toBe("ירושלים ");
  });
});
