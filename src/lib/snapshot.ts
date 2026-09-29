import type { Snapshot } from "@/lib/types";
import { serverState } from "@/lib/serverState";
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
const BAKED = baked as unknown as Snapshot;

export function getSnapshot(): Snapshot {
  // Held on globalThis, not in a module-level `let`: Server Components and
  // Route Handlers are separate module graphs, so the page would otherwise
  // keep rendering the committed snapshot after an upload replaced it.
  return serverState().snapshot ?? BAKED;
}

export function setSnapshot(next: Snapshot): void {
  const state = serverState();
  state.snapshot = next;
  state.uploadedAt = new Date().toISOString();
}

export function resetSnapshot(): void {
  const state = serverState();
  state.snapshot = null;
  state.uploadedAt = null;
}

export function snapshotOrigin(): { origin: "baked" | "uploaded"; at: string | null } {
  const { uploadedAt } = serverState();
  return { origin: uploadedAt ? "uploaded" : "baked", at: uploadedAt };
}

/** Only the rows that may appear in an aggregate. */
export function analyzableDeals() {
  return getSnapshot().deals.filter((d) => d.isAnalyzable);
}
