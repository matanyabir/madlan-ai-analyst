import { describe, it, expect } from "vitest";
import { getSnapshot } from "@/lib/snapshot";
import { getTimeSeries, getStatistics, compareLocations, getAnomalies } from "@/lib/analysis";
import { templateSummary } from "./narrator";

const snap = getSnapshot();

/**
 * The template narrator is what users read whenever the model is
 * unavailable, so it is held to the same grounding standard as the model:
 * no number it was not given, and no claim the evidence does not support.
 */
describe("templateSummary", () => {
  it("quotes only the vetted change, with the sample sizes behind it", () => {
    const r = getTimeSeries(snap, { city: "רמת גן" });
    if (r.type !== "timeSeries") throw new Error("wrong type");
    const text = templateSummary(r);

    if (r.change) {
      expect(text).toContain(Math.abs(r.change.percent).toFixed(1));
      expect(text).toContain(String(r.change.fromN));
    } else {
      // Refusing is the correct answer, not a gap to fill.
      expect(text).toMatch(/אין מספיק עסקאות/);
      expect(text).not.toMatch(/עלייה|ירידה/);
    }
  });

  it("never invents a direction when the change is unavailable", () => {
    const r = getTimeSeries(snap, { city: "רמת גן" });
    if (r.type !== "timeSeries") throw new Error("wrong type");
    const stripped = { ...r, change: null } as typeof r;
    const text = templateSummary(stripped);
    expect(text).not.toMatch(/עלייה|ירידה|גדל|קטן/);
    expect(text).toMatch(/אין מספיק/);
  });

  it("states the sample size on every summary it writes", () => {
    for (const r of [
      getStatistics(snap, { city: "חולון" }),
      compareLocations(snap, ["רמת גן", "גבעתיים"]),
      getAnomalies(snap, {}),
    ]) {
      expect(templateSummary(r)).toMatch(/\d/);
    }
  });

  it("frames anomalies as unusual, never as wrong", () => {
    const r = getAnomalies(snap, {}, 5);
    const text = templateSummary(r);
    expect(text).toMatch(/סטטיסטי/);
    expect(text).toContain("לא שגיאה בנתונים");
  });

  it("passes an unsupported question through verbatim", () => {
    const r = {
      type: "text" as const,
      title: "t",
      body: "המאגר אינו מכיל מידע על בתי ספר",
      evidence: {
        transactionCount: 0, dateRange: null, filters: [], exclusions: [],
        snapshotVersion: "x", notes: [],
      },
    };
    expect(templateSummary(r)).toBe("המאגר אינו מכיל מידע על בתי ספר");
  });
});
