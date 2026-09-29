import { describe, it, expect } from "vitest";
import { getSnapshot } from "@/lib/snapshot";
import {
  getStatistics, getTimeSeries, compareLocations, searchTransactions,
  findComparableDeals, getAnomalies, applyFilters, scoreDeal, WEIGHTS,
  MAX_RESULT_ROWS,
} from "./index";
import { median } from "./stats";
import type { Deal } from "@/lib/types";

const snap = getSnapshot();

describe("applyFilters", () => {
  it("only ever considers analysable rows", () => {
    const { deals } = applyFilters(snap.deals, {});
    expect(deals).toHaveLength(505);
    expect(deals.every((d) => d.isAnalyzable)).toBe(true);
    // The quarantined and conflicting rows are excluded but reported.
    const { exclusions } = applyFilters(snap.deals, {});
    expect(exclusions[0].count).toBe(snap.deals.length - 505);
  });

  it("filters by canonical city, catching every original spelling", () => {
    const { deals } = applyFilters(snap.deals, { city: "תל אביב-יפו" });
    expect(deals.length).toBeGreaterThan(15);
    const rawSpellings = new Set(deals.map((d) => d.raw.city));
    expect(rawSpellings.size).toBeGreaterThan(1); // proves the aliasing worked
  });

  it("treats a false flag as explicit, never as missing", () => {
    const yes = applyFilters(snap.deals, { hasParking: true }).deals;
    const no = applyFilters(snap.deals, { hasParking: false }).deals;
    const unknown = applyFilters(snap.deals, {}).deals.filter((d) => d.hasParking == null);
    expect(unknown.length).toBeGreaterThan(0);
    // The three sets must partition, with unknowns in neither yes nor no.
    expect(yes.length + no.length + unknown.length).toBe(505);
    expect(no.every((d) => d.hasParking === false)).toBe(true);
  });

  it("reports unknown-value exclusions so the evidence panel can show them", () => {
    const { exclusions } = applyFilters(snap.deals, { hasParking: true });
    expect(exclusions.some((e) => e.reason.includes("חניה"))).toBe(true);
  });

  it("describes each filter in Hebrew for the evidence panel", () => {
    const { descriptions } = applyFilters(snap.deals, { city: "רמת גן", roomsMin: 4, roomsMax: 4 });
    expect(descriptions).toEqual([
      { label: "עיר", value: "רמת גן" },
      { label: "חדרים", value: "4" },
    ]);
  });
});

describe("getStatistics", () => {
  it("answers the demo question: how many 4-room deals in רמת גן", () => {
    const r = getStatistics(snap, { city: "רמת גן", roomsMin: 4, roomsMax: 4 }, "count");
    expect(r.type).toBe("statistics");
    if (r.type !== "statistics") return;

    const count = r.metrics.find((m) => m.label === "מספר עסקאות")!.value;
    // Verified independently against the snapshot.
    const expected = snap.deals.filter(
      (d) => d.isAnalyzable && d.city === "רמת גן" && d.rooms === 4,
    ).length;
    expect(count).toBe(expected);
    expect(count).toBeGreaterThan(0);
  });

  it("computes the median from the data, not from a stored field", () => {
    const r = getStatistics(snap, { city: "גבעתיים" }, "price_per_sqm");
    if (r.type !== "statistics") throw new Error("wrong type");

    const expected = median(
      snap.deals
        .filter((d) => d.isAnalyzable && d.city === "גבעתיים")
        .map((d) => d.pricePerSqm!),
    );
    expect(r.metrics.find((m) => m.label.startsWith("חציון"))!.value).toBe(Math.round(expected));
  });

  it("always reports the sample size and date range as evidence", () => {
    const r = getStatistics(snap, { city: "חיפה" });
    expect(r.evidence.transactionCount).toBeGreaterThan(0);
    expect(r.evidence.dateRange).not.toBeNull();
    expect(r.evidence.snapshotVersion).toBe(snap.version);
    expect(r.evidence.metric?.definition).toContain("חציון");
  });

  it("says so rather than inventing an answer when nothing matches", () => {
    const r = getStatistics(snap, { city: "רמת גן", roomsMin: 99 });
    expect(r.type).toBe("insufficient");
    expect(r.evidence.transactionCount).toBe(0);
  });
});

describe("getTimeSeries", () => {
  it("answers the demo question: price per sqm over time in רמת גן", () => {
    const r = getTimeSeries(snap, { city: "רמת גן" }, "price_per_sqm");
    expect(r.type).toBe("timeSeries");
    if (r.type !== "timeSeries") return;

    expect(r.points.length).toBeGreaterThan(3);
    expect(r.points.every((p) => p.n > 0)).toBe(true);
    // Chronological, and never interpolated across an empty period.
    const periods = r.points.map((p) => p.period);
    expect([...periods].sort()).toEqual(periods);
  });

  it("reports the sample size behind every single point", () => {
    const r = getTimeSeries(snap, { city: "נתניה" });
    if (r.type !== "timeSeries") throw new Error("wrong type");
    const total = r.points.reduce((a, p) => a + p.n, 0);
    expect(total).toBe(r.evidence.transactionCount);
  });

  it("drops to quarters when months are too thin, and says so", () => {
    // A single small city over five years has mostly empty months.
    const r = getTimeSeries(snap, { city: "אשדוד" });
    if (r.type !== "timeSeries") throw new Error("wrong type");
    expect(r.granularity).toBe("quarter");
    expect(r.evidence.notes.some((n) => n.includes("רבעונים"))).toBe(true);
  });

  it("refuses to draw a trend from too few points", () => {
    const r = getTimeSeries(snap, { city: "רמת גן", roomsMin: 6, sizeMin: 250 });
    expect(r.type).toBe("insufficient");
  });
});

describe("compareLocations", () => {
  it("answers the demo question: רמת גן vs גבעתיים", () => {
    const r = compareLocations(snap, ["רמת גן", "גבעתיים"], "price_per_sqm");
    expect(r.type).toBe("comparison");
    if (r.type !== "comparison") return;

    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.label).sort()).toEqual(["גבעתיים", "רמת גן"]);
    for (const item of r.items) {
      const expected = median(
        snap.deals.filter((d) => d.isAnalyzable && d.city === item.label).map((d) => d.pricePerSqm!),
      );
      expect(item.value).toBe(Math.round(expected));
    }
  });

  it("refuses a comparison when one side has too little data", () => {
    const r = compareLocations(snap, ["רמת גן"], "price_per_sqm");
    expect(r.type).toBe("insufficient");
  });
});

describe("searchTransactions", () => {
  it("caps the result size regardless of what the caller asks for", () => {
    const r = searchTransactions(snap, {}, 9999);
    if (r.type !== "dealList") throw new Error("wrong type");
    expect(r.deals.length).toBeLessThanOrEqual(MAX_RESULT_ROWS);
    expect(r.evidence.notes.some((n) => n.includes("מתוך"))).toBe(true);
  });

  it("sorts by recency by default", () => {
    const r = searchTransactions(snap, { city: "חולון" }, 10);
    if (r.type !== "dealList") throw new Error("wrong type");
    const dates = r.deals.map((d) => d.dealDate!);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("findComparableDeals", () => {
  it("answers the demo question: 4 rooms, 100 sqm, רמת גן", () => {
    const r = findComparableDeals(snap, { city: "רמת גן", rooms: 4, sizeSqm: 100 }, 8);
    expect(r.type).toBe("dealList");
    if (r.type !== "dealList") return;

    expect(r.deals).toHaveLength(8);
    expect(r.deals.every((d) => d.city === "רמת גן")).toBe(true);
    // Ranked, and every card explains its own score.
    const scores = r.deals.map((d) => d.similarity!.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.deals[0].similarity!.factors.length).toBeGreaterThan(2);
  });

  it("treats the city as a hard filter, not a weight", () => {
    const r = findComparableDeals(snap, { city: "חיפה", rooms: 3 }, 10);
    if (r.type !== "dealList") throw new Error("wrong type");
    expect(r.deals.every((d) => d.city === "חיפה")).toBe(true);
  });

  it("ranks an exact match above a distant one", () => {
    const subject = { city: "רמת גן", rooms: 4, sizeSqm: 100 };
    const mk = (over: Partial<Deal>): Deal => ({
      ...snap.deals.find((d) => d.isAnalyzable)!, city: "רמת גן",
      rooms: 4, sizeSqm: 100, dealDate: "2026-01-01", ...over,
    });
    const exact = scoreDeal(subject, mk({}), "2026-01-01");
    const far = scoreDeal(subject, mk({ rooms: 6, sizeSqm: 200 }), "2026-01-01");
    expect(exact.score).toBeGreaterThan(far.score);
  });

  it("gives a perfect match the full weight of every factor it scores", () => {
    const subject = { city: "רמת גן", rooms: 4, sizeSqm: 100, propertyType: "דירה", neighborhood: "מרכז" };
    const twin: Deal = {
      ...snap.deals.find((d) => d.isAnalyzable)!,
      city: "רמת גן", rooms: 4, sizeSqm: 100, propertyType: "דירה",
      neighborhood: "מרכז", dealDate: "2026-01-01",
    };
    const s = scoreDeal(subject, twin, "2026-01-01");
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(s.score).toBeCloseTo(1, 10);
  });

  it("says there is not enough data rather than returning weak matches", () => {
    const r = findComparableDeals(snap, { city: "עיר שלא קיימת", rooms: 4 }, 8);
    expect(r.type).toBe("insufficient");
    if (r.type !== "insufficient") return;
    expect(r.message).toContain("אין מספיק עסקאות דומות");
  });

  it("explains its own methodology in the evidence", () => {
    const r = findComparableDeals(snap, { city: "רמת גן", rooms: 4, sizeSqm: 100 }, 5);
    expect(r.evidence.notes.some((n) => n.includes("30%"))).toBe(true);
  });
});

describe("getAnomalies", () => {
  it("finds statistically unusual deals and explains the peer group", () => {
    const r = getAnomalies(snap, {}, 10);
    if (r.type !== "dealList") throw new Error(`expected dealList, got ${r.type}`);

    expect(r.deals.length).toBeGreaterThan(0);
    for (const d of r.deals) {
      expect(Math.abs(d.anomaly!.modifiedZ)).toBeGreaterThanOrEqual(3.5);
      expect(d.anomaly!.peerCount).toBeGreaterThanOrEqual(8);
    }
    // Ranked by how unusual they are.
    const zs = r.deals.map((d) => Math.abs(d.anomaly!.modifiedZ));
    expect([...zs].sort((a, b) => b - a)).toEqual(zs);
  });

  it("never asserts the data is wrong, only that it is unusual", () => {
    const r = getAnomalies(snap, {}, 5);

    // The disclaimer note deliberately contains "לא שגיאה בנתונים", so match
    // only affirmative claims: the forbidden words NOT preceded by a negation.
    const affirmative = /(?<!לא )(שגוי|שגיאה בנתונים|לא נכון|מחיר לא אמיתי)/;
    expect(r.title).not.toMatch(affirmative);
    if (r.type === "dealList") {
      expect(JSON.stringify(r.deals)).not.toMatch(affirmative);
    }
    expect(r.evidence.metric!.definition).not.toMatch(affirmative);

    // And the disclaimer itself must be present.
    expect(r.evidence.notes.some((n) => n.includes("לא שגיאה בנתונים"))).toBe(true);
  });

  it("defines what חריגה means, in the evidence, every time", () => {
    const r = getAnomalies(snap, {}, 5);
    expect(r.evidence.metric?.definition).toContain("MAD");
    expect(r.evidence.metric?.definition).toContain("3.5");
  });

  it("reports how many deals it could not judge", () => {
    const r = getAnomalies(snap, {}, 10);
    expect(r.evidence.exclusions.some((e) => e.reason.includes("קבוצות השוואה קטנות"))).toBe(true);
  });
});

describe("evidence is present on every result type", () => {
  const results = [
    getStatistics(snap, { city: "רמת גן" }),
    getTimeSeries(snap, { city: "רמת גן" }),
    compareLocations(snap, ["רמת גן", "גבעתיים"]),
    searchTransactions(snap, { city: "רמת גן" }),
    findComparableDeals(snap, { city: "רמת גן", rooms: 4, sizeSqm: 100 }),
    getAnomalies(snap, {}),
  ];

  it.each(results.map((r) => [r.type, r] as const))("%s carries evidence", (_t, r) => {
    expect(r.evidence.snapshotVersion).toBe(snap.version);
    expect(r.evidence.transactionCount).toBeGreaterThan(0);
    expect(Array.isArray(r.evidence.filters)).toBe(true);
    expect(Array.isArray(r.evidence.notes)).toBe(true);
  });

  it("warns that conflicting duplicates are excluded", () => {
    for (const r of results) {
      expect(r.evidence.notes.some((n) => n.includes("יותר מגרסה אחת"))).toBe(true);
    }
  });
});
