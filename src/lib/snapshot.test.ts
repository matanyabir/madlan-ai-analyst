import { describe, it, expect } from "vitest";
import { getSnapshot, analyzableDeals } from "./snapshot";

/**
 * Guards the committed data/snapshot.json. If someone rebuilds it from a
 * different CSV, or the pipeline regresses, these fail before anything
 * downstream produces a wrong number.
 */
describe("committed snapshot", () => {
  const snap = getSnapshot();

  it("is content-addressed, so the same CSV yields the same version", () => {
    expect(snap.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it("holds 505 analysable deals out of 530 raw rows", () => {
    expect(snap.counts.rawRows).toBe(530);
    expect(snap.counts.analyzable).toBe(505);
    expect(analyzableDeals()).toHaveLength(505);
  });

  it("carries the full issue log, not just a summary", () => {
    expect(snap.issues.length).toBeGreaterThan(600);
    expect(snap.counts.issuesBySeverity.error).toBe(10);
  });

  it("exposes a vocabulary the tool schemas can constrain against", () => {
    expect(snap.vocabulary.cities).toHaveLength(18);
    expect(snap.vocabulary.propertyTypes).toHaveLength(6);
    expect(snap.vocabulary.conditions).toHaveLength(5);
    expect(snap.vocabulary.roomOptions[0]).toBe(1);
  });

  it("keeps quarantined and conflicting rows in the file", () => {
    // Nothing is deleted; the admin log needs them and so does provenance.
    expect(snap.deals.some((d) => d.dealId === "D100317")).toBe(true);
    expect(snap.deals.filter((d) => d.conflictGroup)).toHaveLength(8);
  });
});
