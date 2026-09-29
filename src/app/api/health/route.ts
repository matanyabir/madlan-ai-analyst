import { NextResponse } from "next/server";
import { getSnapshot, snapshotOrigin } from "@/lib/snapshot";
import { cacheStats } from "@/lib/cache/responseCache";
import {
  llmAvailable, ROUTER_MODEL, NARRATOR_MODEL, CANONICALIZER_MODEL,
} from "@/lib/llm/client";
import { readAiPreference } from "@/lib/llm/aiPreference";
import { budgetStats } from "@/lib/llm/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness plus the operational numbers worth watching in a demo. */
export async function GET() {
  const snapshot = getSnapshot();
  return NextResponse.json({
    ok: true,
    snapshot: {
      version: snapshot.version,
      ...snapshotOrigin(),
      analyzable: snapshot.counts.analyzable,
      rawRows: snapshot.counts.rawRows,
      dateRange: snapshot.dateRange,
    },
    llm: {
      configured: llmAvailable(),
      // Per-caller, from the cookie this request carried.
      enabledForThisCaller: (await readAiPreference()) === "on",
      models: {
        router: ROUTER_MODEL,
        narrator: NARRATOR_MODEL,
        canonicalizer: CANONICALIZER_MODEL,
      },
    },
    cache: cacheStats(),
    budget: budgetStats(),
  });
}
