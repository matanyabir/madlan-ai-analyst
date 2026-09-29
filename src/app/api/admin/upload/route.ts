import { NextResponse } from "next/server";
import { guardApi } from "@/lib/auth/guard";
import { ingestCsv, IngestError } from "@/lib/ingest/pipeline";
import { aiCanonicalize } from "@/lib/ingest/aiCanonicalize";
import { setSnapshot } from "@/lib/snapshot";
import { cacheClear } from "@/lib/cache/responseCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comfortably above the 530-row sample; refuses a file that is not this data. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  // Authorization here, not only in proxy.ts — Next's docs are explicit that
  // proxy is for optimistic checks and must not be the security boundary.
  const denied = await guardApi("admin");
  if (denied) return denied;

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ error: "לא התקבל קובץ" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "לא נבחר קובץ" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "הקובץ ריק" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `הקובץ גדול מדי (מעל ${MAX_BYTES / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }

  const text = await file.text();

  try {
    let aiStats: Awaited<ReturnType<typeof aiCanonicalize>>["stats"] = null;

    const snapshot = await ingestCsv(text, {
      sourceFile: file.name,
      // The AI step runs only on what deterministic rules could not resolve.
      canonicalizer: async (deals, issues) => {
        const out = await aiCanonicalize(deals, issues);
        aiStats = out.stats;
        return { deals: out.deals, issues: out.issues };
      },
    });

    // Replace the active dataset for this instance, and drop every cached
    // answer — they were computed from data that is no longer current.
    setSnapshot(snapshot);
    cacheClear();

    return NextResponse.json({
      version: snapshot.version,
      sourceFile: snapshot.sourceFile,
      counts: snapshot.counts,
      dateRange: snapshot.dateRange,
      vocabulary: { cities: snapshot.vocabulary.cities },
      aiStats,
      issues: snapshot.issues,
    });
  } catch (err) {
    if (err instanceof IngestError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[/api/admin/upload]", err);
    return NextResponse.json(
      { error: "עיבוד הקובץ נכשל. ודאו שמדובר בקובץ CSV תקין." },
      { status: 500 },
    );
  }
}
