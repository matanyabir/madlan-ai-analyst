import type { Snapshot } from "@/lib/types";

/**
 * Mutable server state, shared across module instances.
 *
 * Next bundles Server Components and Route Handlers into **separate module
 * graphs**, so a module-level `let` is not one variable — each graph gets its
 * own copy. That makes the obvious implementation silently wrong in a way
 * that is hard to spot, because the writes work and only the reads from the
 * *other* graph are stale:
 *
 *   POST /api/admin/upload   replaces the snapshot   (route-handler copy)
 *   GET  /api/health         reports the new one     (route-handler copy) ✓
 *   GET  /                   still shows the old one (server-component copy) ✗
 *
 * Holding the state on `globalThis` under a registered symbol gives every
 * module graph in the process the same object. This is the same pattern used
 * for a database client singleton in Next, and for the same reason.
 *
 * It does NOT make state shared across serverless *instances* — that still
 * needs Postgres or a KV store, and remains the documented next step. What it
 * fixes is the much worse problem of one instance disagreeing with itself.
 */

interface ServerState {
  /** Null until something replaces the committed snapshot at runtime. */
  snapshot: Snapshot | null;
  uploadedAt: string | null;
  aiEnabled: boolean;
}

const KEY = Symbol.for("madlan.serverState");

type GlobalWithState = typeof globalThis & { [KEY]?: ServerState };

export function serverState(): ServerState {
  const g = globalThis as GlobalWithState;
  g[KEY] ??= { snapshot: null, uploadedAt: null, aiEnabled: true };
  return g[KEY];
}
