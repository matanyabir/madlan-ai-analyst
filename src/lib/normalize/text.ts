/** Whitespace and text canonicalization. Runs before every other rule. */

/**
 * Trims and collapses internal whitespace runs.
 *
 * The CSV has 82 values across five columns that differ from each other only
 * by surrounding whitespace ("מרכז " vs "מרכז"), which would otherwise split
 * one neighborhood into two.
 */
export function cleanText(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/** True when cleanText actually changed something worth logging. */
export function wasWhitespaceDirty(raw: string | undefined | null): boolean {
  if (raw == null) return false;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return cleaned !== raw && cleaned !== "";
}
