/** Domain types shared by the ingest pipeline, the analysis engine and the UI. */

export type DatePrecision = "day" | "month";

/** How confident we are that a row describes a real, analysable transaction. */
export type QuarantineReason =
  | "no_price"
  | "zero_price"
  | "implausible_price"
  | "no_size"
  | "unresolved_city";

/** A single row after normalization. `raw` is always preserved for traceability. */
export interface Deal {
  /** Stable key. For conflicting duplicates this is `${dealId}#${n}`. */
  key: string;
  dealId: string;

  city: string | null;
  neighborhood: string | null;
  street: string | null;
  propertyType: string | null;
  condition: string | null;

  rooms: number | null;
  sizeSqm: number | null;
  floor: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;

  hasElevator: boolean | null;
  hasParking: boolean | null;
  hasBalcony: boolean | null;
  hasSafeRoom: boolean | null;

  /** ISO yyyy-mm-dd. Day-less source dates are the 1st with precision "month". */
  dealDate: string | null;
  datePrecision: DatePrecision | null;

  priceNis: number | null;
  /** Always priceNis / sizeSqm when both exist — never the CSV's stated value. */
  pricePerSqm: number | null;
  /** The CSV's stated price_per_sqm, kept even when it disagrees. */
  pricePerSqmRaw: number | null;
  /** True when priceNis was reconstructed from size x stated price_per_sqm. */
  priceDerived: boolean;

  source: string | null;

  /** Excluded from every aggregate when false. */
  isAnalyzable: boolean;
  quarantineReasons: QuarantineReason[];
  /** Set on both rows of a conflicting duplicate pair. */
  conflictGroup: string | null;

  /** Verbatim CSV cells, for the admin log and provenance. */
  raw: Record<string, string>;
  rowNumber: number;
}

export type IssueSeverity = "info" | "warning" | "error";
export type IssueResolver = "deterministic" | "ai" | "none";

export type IssueType =
  | "whitespace_trimmed"
  | "city_alias_applied"
  | "city_unresolved"
  | "rooms_suffix_stripped"
  | "date_reformatted"
  | "date_missing_day"
  | "date_unparseable"
  | "price_separators_stripped"
  | "price_derived"
  | "price_missing"
  | "price_zero"
  | "price_implausible"
  | "price_per_sqm_conflict"
  | "missing_value"
  | "unparseable_number"
  | "duplicate_identical"
  | "duplicate_conflict"
  | "ai_canonicalized"
  | "ai_rejected";

/** One problem found, and what the pipeline did about it. */
export interface IngestIssue {
  rowNumber: number;
  dealId: string;
  field: string;
  type: IssueType;
  severity: IssueSeverity;
  rawValue: string;
  resolvedValue: string | null;
  resolver: IssueResolver;
  /** Only set by the AI canonicalization step. */
  confidence?: number;
  note?: string;
}

export interface Vocabulary {
  cities: string[];
  neighborhoodsByCity: Record<string, string[]>;
  propertyTypes: string[];
  conditions: string[];
  sources: string[];
  roomOptions: number[];
}

export interface SnapshotCounts {
  rawRows: number;
  identicalDuplicatesCollapsed: number;
  conflictGroups: number;
  conflictRowsHeldOut: number;
  quarantined: number;
  analyzable: number;
  issuesBySeverity: Record<IssueSeverity, number>;
  issuesByType: Record<string, number>;
}

export interface Snapshot {
  version: string;
  builtAt: string;
  sourceFile: string;
  deals: Deal[];
  issues: IngestIssue[];
  vocabulary: Vocabulary;
  counts: SnapshotCounts;
  dateRange: { min: string; max: string } | null;
}
