import type { Snapshot } from "@/lib/types";
import baked from "../../data/snapshot.json";

/**
 * The active dataset, held in module memory.
 *
 * The committed data/snapshot.json is imported rather than read from disk so
 * it is bundled into the serverless function — a cold start always has good
 * data, with no I/O and no database round-trip.
 *
 * An admin upload replaces it for the lifetime of *this instance only*. That
 * is the honest limitation of having no database: another instance, or this
 * one after a cold start, reverts to the committed snapshot. The upload UI
 * says so, and offers the rebuilt snapshot as a download to commit. Replacing
 * this module with a Postgres-backed loader is the documented next step.
 */
let active: Snapshot = baked as unknown as Snapshot;

/** Set when a runtime upload has replaced the baked snapshot on this instance. */
let uploadedAt: string | null = null;

export function getSnapshot(): Snapshot {
  return active;
}

export function setSnapshot(next: Snapshot): void {
  active = next;
  uploadedAt = new Date().toISOString();
}

export function resetSnapshot(): void {
  active = baked as unknown as Snapshot;
  uploadedAt = null;
}

export function snapshotOrigin(): { origin: "baked" | "uploaded"; at: string | null } {
  return { origin: uploadedAt ? "uploaded" : "baked", at: uploadedAt };
}

/** Only the rows that may appear in an aggregate. */
export function analyzableDeals() {
  return active.deals.filter((d) => d.isAnalyzable);
}
