import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ingestCsv, IngestError } from "./pipeline";
import { dedupe } from "./dedupe";
import { normalizeRow } from "@/lib/normalize";
import type { Snapshot } from "@/lib/types";

const CSV = readFileSync(resolve("data/madlan_deals_sample.csv"), "utf8");

/**
 * These assertions are the regression net for the whole data layer. Every
 * number is one the profiler measured (docs/CSV_PROFILE.md) — if the pipeline
 * drifts, CI fails here rather than silently producing a wrong median.
 */
describe("ingestCsv against the real sample CSV", () => {
  let snap: Snapshot;
  beforeAll(async () => {
    snap = await ingestCsv(CSV, { sourceFile: "madlan_deals_sample.csv" });
  });

  it("reads all 530 rows", () => {
    expect(snap.counts.rawRows).toBe(530);
  });

  it("collapses 6 identical duplicates and holds out 4 conflicting pairs", () => {
    expect(snap.counts.identicalDuplicatesCollapsed).toBe(6);
    expect(snap.counts.conflictGroups).toBe(4);
    expect(snap.counts.conflictRowsHeldOut).toBe(8);
  });

  it("names the four conflicting ids", () => {
    const conflicted = [...new Set(
      snap.deals.filter((d) => d.conflictGroup).map((d) => d.dealId),
    )].sort();
    expect(conflicted).toEqual(["D100017", "D100032", "D100124", "D100303"]);
  });

  it("keeps both rows of every conflict and excludes both from analysis", () => {
    const rows = snap.deals.filter((d) => d.conflictGroup === "D100017");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).sort()).toEqual(["D100017#1", "D100017#2"]);
    expect(rows.every((r) => !r.isAnalyzable)).toBe(true);
    // The two reported prices are both preserved.
    expect(new Set(rows.map((r) => r.priceNis))).toEqual(new Set([1919000, 1851548]));
  });

  it("logs 28 price_per_sqm conflicts", () => {
    expect(snap.counts.issuesByType.price_per_sqm_conflict).toBe(28);
  });

  it("strips a ₪ sign from 12 prices and reads the real figure", () => {
    // These twelve were reported as "missing" by an earlier profiler that
    // stripped only commas. They are not missing — see docs/AI_LOG.md #5.
    expect(snap.counts.issuesByType.price_currency_symbol_stripped).toBe(12);
    const d = snap.deals.find((x) => x.dealId === "D100468")!;
    expect(d.raw.price_nis).toBe("₪12,144,000");
    expect(d.priceNis).toBe(12_144_000);
    expect(d.priceDerived).toBe(false);
  });

  it("derives no prices, because none are actually missing", () => {
    expect(snap.counts.issuesByType.price_derived).toBeUndefined();
    expect(snap.deals.filter((d) => d.priceDerived)).toHaveLength(0);
    expect(snap.counts.issuesByType.price_missing).toBeUndefined();
  });

  it("catches the conflict that the ₪ sign was hiding", () => {
    // D100417 is only comparable once its price parses at all.
    const issue = snap.issues.find(
      (i) => i.dealId === "D100417" && i.type === "price_per_sqm_conflict",
    );
    expect(issue).toBeDefined();
    const d = snap.deals.find((x) => x.dealId === "D100417")!;
    expect(d.priceNis).toBe(1_884_000);
    expect(Math.round(d.pricePerSqm!)).toBe(17_284);
    expect(d.pricePerSqmRaw).toBe(19_528);
  });

  it("marks 26 deals as month-precision", () => {
    expect(snap.deals.filter((d) => d.datePrecision === "month")).toHaveLength(26);
    expect(snap.counts.issuesByType.date_missing_day).toBe(26);
  });

  it("reformats 131 non-ISO dates", () => {
    // 76 dd/mm/yyyy + 55 dd.mm.yyyy. Day-less dates are logged separately.
    expect(snap.counts.issuesByType.date_reformatted).toBe(131);
  });

  it("strips separators from 56 prices", () => {
    expect(snap.counts.issuesByType.price_separators_stripped).toBe(56);
  });

  it("quarantines the zero price and the implausible ₪18,000 deal", () => {
    const quarantined = snap.deals.filter((d) => !d.isAnalyzable && !d.conflictGroup);
    const ids = quarantined.map((d) => d.dealId);
    expect(ids).toContain("D100251");
    expect(ids).toContain("D100317");

    const absurd = snap.deals.find((d) => d.dealId === "D100317")!;
    expect(absurd.quarantineReasons).toContain("implausible_price");
    expect(absurd.raw.price_nis).toBe("18000"); // kept, not deleted
  });

  it("resolves every city — nothing falls through to the AI step", () => {
    expect(snap.deals.filter((d) => d.city === null)).toHaveLength(0);
    expect(snap.counts.issuesByType.city_unresolved).toBeUndefined();
  });

  it("collapses 29 city spellings to 18 canonical names", () => {
    expect(snap.vocabulary.cities).toHaveLength(18);
    expect(snap.vocabulary.cities).toContain("תל אביב-יפו");
    expect(snap.vocabulary.cities).toContain("מודיעין-מכבים-רעות");
    expect(snap.vocabulary.cities).not.toContain("מודיעין");
  });

  it("merges all five Tel Aviv spellings into one city of 22 deals", () => {
    // 7 + 5 + 4 + 4 + 2 raw rows across the five spellings.
    const tlv = snap.deals.filter((d) => d.city === "תל אביב-יפו");
    expect(tlv).toHaveLength(22);
  });

  it("keeps every raw row accounted for", () => {
    // 530 raw = deals kept + identical duplicates collapsed away.
    expect(snap.deals.length + snap.counts.identicalDuplicatesCollapsed).toBe(530);
  });

  it("leaves a usable analysable population", () => {
    expect(snap.counts.analyzable).toBeGreaterThan(500);
    expect(snap.counts.analyzable).toBe(
      snap.deals.length - snap.counts.quarantined - snap.counts.conflictRowsHeldOut,
    );
  });

  it("never lets an analysable deal carry a null price, size or city", () => {
    for (const d of snap.deals.filter((x) => x.isAnalyzable)) {
      expect(d.priceNis).toBeGreaterThan(0);
      expect(d.sizeSqm).toBeGreaterThan(0);
      expect(d.city).not.toBeNull();
      expect(d.pricePerSqm).toBeGreaterThan(0);
    }
  });

  it("always derives pricePerSqm from price/size, never from the CSV", () => {
    for (const d of snap.deals.filter((x) => x.isAnalyzable)) {
      expect(d.pricePerSqm!).toBeCloseTo(d.priceNis! / d.sizeSqm!, 6);
    }
  });

  it("reports a date range inside the observed window", () => {
    expect(snap.dateRange).toEqual({ min: "2021-01-05", max: "2026-07-26" });
  });

  it("builds a neighbourhood vocabulary keyed by city", () => {
    // מרכז exists in nine cities, so it must never be a global key.
    const citiesWithMerkaz = Object.entries(snap.vocabulary.neighborhoodsByCity)
      .filter(([, hoods]) => hoods.includes("מרכז"));
    expect(citiesWithMerkaz.length).toBeGreaterThan(1);
  });
});

describe("ingestCsv input validation", () => {
  it("rejects an empty file", async () => {
    await expect(ingestCsv("")).rejects.toThrow(IngestError);
  });

  it("rejects a CSV missing required columns", async () => {
    await expect(ingestCsv("foo,bar\n1,2")).rejects.toThrow(/חסרות עמודות חובה/);
  });
});

describe("dedupe", () => {
  const row = (over: Record<string, string>) => ({
    deal_id: "D1", city: "רמת גן", neighborhood: "מרכז", street: "ביאליק",
    property_type: "דירה", rooms: "4", size_sqm: "100", floor: "2",
    total_floors: "8", year_built: "2000", condition: "שמור",
    has_elevator: "כן", has_parking: "כן", has_balcony: "כן", has_safe_room: "כן",
    deal_date: "2025-01-01", price_nis: "3000000", price_per_sqm: "30000",
    source: "רשות המסים", ...over,
  });

  it("collapses rows that differ only by whitespace", () => {
    // D100032's two rows differ in condition whitespace AND price; this
    // isolates the whitespace half of that behaviour.
    const deals = [row({}), row({ condition: "  שמור " })].map((r, i) => normalizeRow(r, i + 2).deal);
    const result = dedupe(deals);
    expect(result.identicalCollapsed).toBe(1);
    expect(result.conflictGroups).toBe(0);
    expect(result.deals).toHaveLength(1);
  });

  it("treats a differing price as a conflict, not a duplicate", () => {
    const deals = [row({}), row({ price_nis: "3100000", source: "מתווך" })]
      .map((r, i) => normalizeRow(r, i + 2).deal);
    const result = dedupe(deals);
    expect(result.conflictGroups).toBe(1);
    expect(result.conflictRowsHeldOut).toBe(2);
    expect(result.deals.every((d) => !d.isAnalyzable)).toBe(true);
    expect(result.issues[0].note).toMatch(/priceNis/);
  });

  it("leaves unique ids untouched", () => {
    const deals = [row({}), row({ deal_id: "D2" })].map((r, i) => normalizeRow(r, i + 2).deal);
    const result = dedupe(deals);
    expect(result.deals).toHaveLength(2);
    expect(result.conflictGroups).toBe(0);
    expect(result.identicalCollapsed).toBe(0);
  });
});
