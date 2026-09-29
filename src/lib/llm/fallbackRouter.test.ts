import { describe, it, expect } from "vitest";
import { getSnapshot } from "@/lib/snapshot";
import { fallbackRoute } from "./fallbackRouter";
import { executeToolCall } from "./execute";

const snap = getSnapshot();

/**
 * This is the path the product takes when Claude is unavailable. It must
 * answer the five demo questions correctly with no network at all.
 */
describe("fallbackRoute on the demo questions", () => {
  it("routes a trend question to get_time_series", () => {
    const call = fallbackRoute(snap, 'איך השתנה המחיר למ"ר ברמת גן?');
    expect(call.name).toBe("get_time_series");
    expect(call.input).toMatchObject({ filters: { city: "רמת גן" }, metric: "price_per_sqm" });
  });

  it("routes a comparison to compare_locations with both cities", () => {
    const call = fallbackRoute(snap, "תשווה בין רמת גן לגבעתיים");
    expect(call.name).toBe("compare_locations");
    expect((call.input as { cities: string[] }).cities.sort()).toEqual(["גבעתיים", "רמת גן"]);
  });

  it("routes a described property to find_comparable_deals with its parameters", () => {
    const call = fallbackRoute(snap, 'מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ"ר ברמת גן');
    expect(call.name).toBe("find_comparable_deals");
    expect(call.input).toMatchObject({ city: "רמת גן", rooms: 4, sizeSqm: 100 });
  });

  it("extracts a price written as millions", () => {
    const call = fallbackRoute(
      snap, 'מצא עסקאות דומות לדירה של 4 חדרים, 100 מ"ר, ברמת גן ב-3.9 מיליון',
    );
    expect(call.input).toMatchObject({ city: "רמת גן", rooms: 4, sizeSqm: 100, priceNis: 3_900_000 });
  });

  it("routes a count question to get_statistics with metric=count", () => {
    const call = fallbackRoute(snap, "כמה עסקאות של 4 חדרים יש ברמת גן?");
    expect(call.name).toBe("get_statistics");
    expect(call.input).toMatchObject({
      filters: { city: "רמת גן", roomsMin: 4, roomsMax: 4 }, metric: "count",
    });
  });

  it("routes an anomaly question to find_anomalies", () => {
    expect(fallbackRoute(snap, "מצא עסקאות חריגות").name).toBe("find_anomalies");
  });

  it("declines an unsupported question instead of guessing", () => {
    for (const q of [
      "איזו שכונה הכי שקטה?",
      "כדאי להשקיע ברמת גן?",
      "מה יהיה המחיר ב-2030?",
      "איפה יש בתי ספר טובים?",
      "מה התשואה הצפויה?",
    ]) {
      expect(fallbackRoute(snap, q).name, q).toBe("answer_not_supported");
    }
  });
});

describe("forecast questions are declined, using the data's own horizon", () => {
  it("declines any year after the last transaction in the snapshot", () => {
    // The snapshot ends 2026-07. 2027 onwards is a forecast, not a query.
    for (const q of ["מה יהיה המחיר ב-2030?", "כמה יעלו דירות ברמת גן ב-2027?"]) {
      expect(fallbackRoute(snap, q).name, q).toBe("answer_not_supported");
    }
  });

  it("does not decline a year inside the data", () => {
    expect(fallbackRoute(snap, "כמה עסקאות היו ברמת גן ב-2024?").name)
      .not.toBe("answer_not_supported");
  });
});

describe('"כמה" means both "how many" and "how much"', () => {
  // A price question that begins with כמה used to route to metric=count and
  // answer "how much does an average garden flat cost" with a transaction
  // count. See docs/AI_LOG.md #9.
  it.each([
    ["כמה עולה דירת גן ממוצעת", "price"],
    ["כמה עולה דירה ברמת גן", "price"],
    ["מה המחיר הממוצע ברמת גן", "price"],
    ["כמה שווה פנטהאוז בנתניה", "price"],
  ])("%s asks how much -> %s", (q, metric) => {
    const call = fallbackRoute(snap, q);
    expect(call.name).toBe("get_statistics");
    expect(call.input).toMatchObject({ metric });
  });

  it.each([
    "כמה עסקאות של 4 חדרים יש ברמת גן?",
    "כמה דירות נמכרו בחולון",
    "מספר העסקאות בנתניה",
  ])("%s asks how many -> count", (q) => {
    expect(fallbackRoute(snap, q).input).toMatchObject({ metric: "count" });
  });

  it.each([
    'מה המחיר למ"ר בגבעתיים',
    "מה המחיר למ״ר בגבעתיים",
    "כמה עולה מטר רבוע בחיפה",
  ])("%s explicitly asks per-sqm", (q) => {
    expect(fallbackRoute(snap, q).input).toMatchObject({ metric: "price_per_sqm" });
  });

  it("still extracts the property type from a price question", () => {
    expect(fallbackRoute(snap, "כמה עולה דירת גן ממוצעת").input)
      .toMatchObject({ filters: { propertyType: "דירת גן" } });
  });
});

describe("fallbackRoute entity extraction", () => {
  it("resolves city shorthands the canonical list does not contain", () => {
    expect(fallbackRoute(snap, 'כמה עסקאות יש בת"א?').input)
      .toMatchObject({ filters: { city: "תל אביב-יפו" } });
    expect(fallbackRoute(snap, 'מה המחיר בב"ש?').input)
      .toMatchObject({ filters: { city: "באר שבע" } });
  });

  it("prefers the longest city match", () => {
    const call = fallbackRoute(snap, "כמה עסקאות במודיעין-מכבים-רעות?");
    expect(call.input).toMatchObject({ filters: { city: "מודיעין-מכבים-רעות" } });
  });

  it("reads rooms written as a Hebrew word", () => {
    expect(fallbackRoute(snap, "כמה עסקאות של ארבעה חדרים יש בחיפה?").input)
      .toMatchObject({ filters: { city: "חיפה", roomsMin: 4, roomsMax: 4 } });
  });

  it("reads half-rooms and the חד' abbreviation", () => {
    expect(fallbackRoute(snap, "כמה דירות 3.5 חד' יש בחולון?").input)
      .toMatchObject({ filters: { roomsMin: 3.5, roomsMax: 3.5 } });
  });

  it("picks up a property type from the vocabulary", () => {
    expect(fallbackRoute(snap, "כמה פנטהאוז יש בנתניה?").input)
      .toMatchObject({ filters: { city: "נתניה", propertyType: "פנטהאוז" } });
  });

  it("drops an out-of-range extraction rather than emitting an invalid call", () => {
    // "999 חדרים" exceeds the tool schema's maximum. The fallback has no
    // second chance behind it, so it must not produce a call we reject.
    const call = fallbackRoute(snap, "עסקאות עם 999 חדרים");
    expect(call.input).toMatchObject({ filters: {} });
  });

  it("falls back to statistics when it recognises nothing", () => {
    const call = fallbackRoute(snap, "שלום");
    expect(call.name).toBe("get_statistics");
    expect(call.input).toMatchObject({ filters: {} });
  });
});

describe("every fallback route produces a valid, executable call", () => {
  const questions = [
    'איך השתנה המחיר למ"ר ברמת גן?',
    "תשווה בין רמת גן לגבעתיים",
    'מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ"ר ברמת גן',
    "כמה עסקאות של 4 חדרים יש בחיפה?",
    "מצא עסקאות חריגות",
    "איזו שכונה הכי שקטה?",
    "הראה לי עסקאות בהרצליה",
    "שלום",
    "",
    "עיר שלא קיימת בכלל 999 חדרים",
  ];

  it.each(questions)("%s", (q) => {
    const call = fallbackRoute(snap, q);
    const out = executeToolCall(snap, call);
    // The fallback must never emit something our own validator rejects.
    expect(out.ok, out.ok ? "" : `${out.error}: ${out.detail}`).toBe(true);
  });
});
