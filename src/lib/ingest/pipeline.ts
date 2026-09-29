import { createHash } from "node:crypto";
import Papa from "papaparse";
import type {
  Deal, IngestIssue, IssueSeverity, Snapshot, SnapshotCounts, Vocabulary,
} from "@/lib/types";
import { normalizeRow, type RawRow } from "@/lib/normalize";
import {
  CANONICAL_CITIES, CANONICAL_CONDITIONS, CANONICAL_PROPERTY_TYPES, CANONICAL_SOURCES,
} from "@/lib/normalize/aliases";
import { dedupe } from "./dedupe";

export const REQUIRED_COLUMNS = [
  "deal_id", "city", "property_type", "rooms", "size_sqm", "deal_date", "price_nis",
];

export class IngestError extends Error {}

/** Optional hook so the admin upload can resolve unknown values with AI. */
export type Canonicalizer = (
  deals: Deal[],
  issues: IngestIssue[],
) => Promise<{ deals: Deal[]; issues: IngestIssue[] }>;

function buildVocabulary(deals: Deal[]): Vocabulary {
  const analyzable = deals.filter((d) => d.isAnalyzable);
  const neighborhoodsByCity: Record<string, Set<string>> = {};
  const rooms = new Set<number>();

  for (const d of analyzable) {
    if (d.city && d.neighborhood) {
      (neighborhoodsByCity[d.city] ??= new Set()).add(d.neighborhood);
    }
    if (d.rooms != null) rooms.add(d.rooms);
  }

  const cities = [...new Set(analyzable.map((d) => d.city).filter((c): c is string => !!c))]
    .sort((a, b) => a.localeCompare(b, "he"));

  return {
    cities,
    neighborhoodsByCity: Object.fromEntries(
      Object.entries(neighborhoodsByCity).map(([city, set]) => [
        city,
        [...set].sort((a, b) => a.localeCompare(b, "he")),
      ]),
    ),
    // The canonical lists, narrowed to what actually survived ingestion.
    propertyTypes: CANONICAL_PROPERTY_TYPES.filter((t) =>
      analyzable.some((d) => d.propertyType === t),
    ),
    conditions: CANONICAL_CONDITIONS.filter((c) => analyzable.some((d) => d.condition === c)),
    sources: CANONICAL_SOURCES.filter((s) => analyzable.some((d) => d.source === s)),
    roomOptions: [...rooms].sort((a, b) => a - b),
  };
}

function tally(issues: IngestIssue[], deals: Deal[], dedupeStats: {
  identicalCollapsed: number; conflictGroups: number; conflictRowsHeldOut: number;
}, rawRows: number): SnapshotCounts {
  const bySeverity: Record<IssueSeverity, number> = { info: 0, warning: 0, error: 0 };
  const byType: Record<string, number> = {};
  for (const i of issues) {
    bySeverity[i.severity]++;
    byType[i.type] = (byType[i.type] ?? 0) + 1;
  }
  return {
    rawRows,
    identicalDuplicatesCollapsed: dedupeStats.identicalCollapsed,
    conflictGroups: dedupeStats.conflictGroups,
    conflictRowsHeldOut: dedupeStats.conflictRowsHeldOut,
    // Conflicting rows are quarantined too, but counted separately above.
    quarantined: deals.filter((d) => !d.isAnalyzable && !d.conflictGroup).length,
    analyzable: deals.filter((d) => d.isAnalyzable).length,
    issuesBySeverity: bySeverity,
    issuesByType: byType,
  };
}

export interface IngestOptions {
  sourceFile?: string;
  /** Runs after deterministic normalization, before dedupe. */
  canonicalizer?: Canonicalizer;
}

/**
 * Turns raw CSV text into a Snapshot: normalize every row, resolve duplicates,
 * collect the issue log, and derive the vocabulary the LLM tool schemas use.
 *
 * Pure apart from the optional canonicalizer, so the admin upload endpoint and
 * the build-time script run byte-identical logic.
 */
export async function ingestCsv(csvText: string, options: IngestOptions = {}): Promise<Snapshot> {
  const parsed = Papa.parse<RawRow>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.data.length) {
    throw new IngestError("הקובץ ריק או שאינו CSV תקין");
  }

  const columns = Object.keys(parsed.data[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new IngestError(`חסרות עמודות חובה בקובץ: ${missing.join(", ")}`);
  }

  // 1 — normalize every row independently.
  let deals: Deal[] = [];
  let issues: IngestIssue[] = [];
  parsed.data.forEach((row, i) => {
    const { deal, issues: rowIssues } = normalizeRow(row, i + 2); // +2: 1-based, past header
    deals.push(deal);
    issues.push(...rowIssues);
  });

  // 2 — optionally let AI resolve what the deterministic rules could not.
  if (options.canonicalizer) {
    const result = await options.canonicalizer(deals, issues);
    deals = result.deals;
    issues = result.issues;
  }

  // 3 — resolve duplicate ids.
  const deduped = dedupe(deals);
  issues.push(...deduped.issues);

  const analyzable = deduped.deals.filter((d) => d.isAnalyzable && d.dealDate);
  const dates = analyzable.map((d) => d.dealDate!).sort();

  // Content-addressed, not timestamped: rebuilding from the same CSV must
  // produce the same version, because the response cache keys on it.
  const version = createHash("sha256")
    .update(csvText)
    .digest("hex")
    .slice(0, 12);

  return {
    version,
    builtAt: new Date().toISOString(),
    sourceFile: options.sourceFile ?? "upload",
    deals: deduped.deals,
    issues: issues.sort((a, b) => a.rowNumber - b.rowNumber),
    vocabulary: buildVocabulary(deduped.deals),
    counts: tally(issues, deduped.deals, deduped, parsed.data.length),
    dateRange: dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null,
  };
}

export { CANONICAL_CITIES };
