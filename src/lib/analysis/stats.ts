/**
 * Robust statistics.
 *
 * Everything here prefers the median over the mean. With 505 transactions
 * spanning ₪492,000 to ₪44,000,000, a mean says more about whether a
 * penthouse happened to fall inside the filter than about the market.
 */

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Linear-interpolated percentile, p in [0,1]. Matches numpy's default. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = p * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Median absolute deviation — the robust analogue of standard deviation.
 * Unlike σ, a single extreme value cannot inflate it and thereby hide itself.
 */
export function mad(values: number[]): number {
  if (!values.length) return NaN;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Iglewicz–Hoaglin modified z-score.
 *
 *   Mz = 0.6745 × (x − median) / MAD
 *
 * 0.6745 is the 0.75 quantile of the standard normal, which rescales MAD so
 * that for normally distributed data Mz is comparable to a conventional
 * z-score. The published outlier threshold is |Mz| ≥ 3.5.
 *
 * Returns NaN when MAD is 0 (a peer group with no spread), which callers must
 * treat as "cannot judge" rather than as "not an outlier".
 */
export const ANOMALY_THRESHOLD = 3.5;

export function modifiedZScores(values: number[]): number[] {
  const m = median(values);
  const d = mad(values);
  if (!d) return values.map(() => NaN);
  return values.map((v) => (0.6745 * (v - m)) / d);
}

export function round(value: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
