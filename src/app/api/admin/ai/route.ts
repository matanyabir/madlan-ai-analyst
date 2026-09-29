import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/auth/guard";
import { isAiEnabled, setAiEnabled, llmKeyConfigured } from "@/lib/llm/client";
import { cacheClear, cacheStats } from "@/lib/cache/responseCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ enabled: z.boolean() });

export async function GET() {
  const denied = await guardApi("admin");
  if (denied) return denied;
  return NextResponse.json({
    enabled: isAiEnabled(),
    keyConfigured: llmKeyConfigured(),
    cache: cacheStats(),
  });
}

export async function POST(request: Request) {
  const denied = await guardApi("admin");
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "ערך לא תקין" }, { status: 400 });
  }

  const enabled = setAiEnabled(parsed.data.enabled);

  /*
   * Flushing the cache is not optional here.
   *
   * Cached answers carry the prose that produced them and a `degraded` flag.
   * Leaving them in place after a toggle would serve model-written
   * explanations while the model is off — and templated ones after it comes
   * back — so the badge would be lying about the answer the user is looking
   * at. The numbers would still be right; the provenance would not.
   */
  cacheClear();

  return NextResponse.json({ enabled, keyConfigured: llmKeyConfigured() });
}
