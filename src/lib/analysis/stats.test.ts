import { describe, it, expect } from "vitest";
import { median, mean, percentile, mad, modifiedZScores, ANOMALY_THRESHOLD } from "./stats";

/** Fixtures are hand-computed; none of these expectations came from running the code. */
describe("median", () => {
  it("takes the middle of an odd-length set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the middle pair of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("is unmoved by an extreme value that would wreck the mean", () => {
    // This is the whole reason the app uses medians.
    const normal = [30000, 31000, 32000, 33000, 34000];
    const withPenthouse = [...normal, 145000];
    expect(median(normal)).toBe(32000);
    expect(median(withPenthouse)).toBe(32500);
    expect(mean(withPenthouse)).toBeCloseTo(50833.33, 1); // mean is now nonsense
  });
  it("returns NaN for an empty set rather than 0", () => {
    expect(median([])).toBeNaN();
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    // p25 of [1,2,3,4,5]: idx = 0.25*4 = 1 -> exactly 2
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    // p30: idx = 0.3*4 = 1.2 -> 2 + 0.2*(3-2) = 2.2
    expect(percentile([1, 2, 3, 4, 5], 0.3)).toBeCloseTo(2.2, 10);
  });
  it("handles the endpoints and a single value", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
    expect(percentile([7], 0.5)).toBe(7);
  });
});

describe("mad", () => {
  it("is the median of absolute deviations from the median", () => {
    // median([1,2,3,4,5]) = 3; deviations [2,1,0,1,2]; median = 1
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
  });
  it("is zero when every value is identical", () => {
    expect(mad([5, 5, 5])).toBe(0);
  });
});

describe("modifiedZScores", () => {
  it("scores the median at zero", () => {
    const z = modifiedZScores([1, 2, 3, 4, 5]);
    expect(z[2]).toBe(0);
  });

  it("matches the Iglewicz-Hoaglin formula by hand", () => {
    // values [10,12,14,16,100]: median 14, deviations [4,2,0,2,86], MAD 2
    // Mz(100) = 0.6745 * (100-14) / 2 = 29.0035
    const z = modifiedZScores([10, 12, 14, 16, 100]);
    expect(z[4]).toBeCloseTo(29.0035, 4);
    expect(Math.abs(z[4])).toBeGreaterThan(ANOMALY_THRESHOLD);
  });

  it("returns NaN when MAD is zero instead of dividing by it", () => {
    // A peer group with no spread cannot judge anything. Callers must treat
    // NaN as "cannot judge", never as "not an outlier".
    expect(modifiedZScores([5, 5, 5]).every(Number.isNaN)).toBe(true);
  });

  it("does not let one outlier mask itself the way sigma would", () => {
    const values = [100, 102, 104, 106, 108, 110, 112, 900];
    const z = modifiedZScores(values);
    expect(Math.abs(z[7])).toBeGreaterThan(ANOMALY_THRESHOLD);

    // For contrast: a conventional z-score misses it, because the outlier
    // inflates the standard deviation it is being measured against.
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
    expect(Math.abs((900 - m) / sd)).toBeLessThan(3);
  });
});
