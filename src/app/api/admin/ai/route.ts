import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/auth/guard";
import { llmAvailable } from "@/lib/llm/client";
import { AI_COOKIE, readAiPreference } from "@/lib/llm/aiPreference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ enabled: z.boolean() });

export async function GET() {
  const denied = await guardApi("admin");
  if (denied) return denied;
  return NextResponse.json({
    enabled: (await readAiPreference()) === "on",
    keyConfigured: llmAvailable(),
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

  const { enabled } = parsed.data;
  const response = NextResponse.json({ enabled, keyConfigured: llmAvailable() });

  /*
   * The preference rides on the request rather than living on the server.
   *
   * Vercel runs many instances and globalThis is per-instance, so a
   * server-side flag written by one request is invisible to the next: the
   * routing would change while the pages showing the state disagreed. A
   * cookie is deterministic on any number of instances and survives cold
   * starts. Not httpOnly — the browser never reads it, but there is nothing
   * to protect either, and leaving it readable makes debugging obvious.
   */
  if (enabled) {
    response.cookies.set(AI_COOKIE, "", { path: "/", maxAge: 0 });
  } else {
    response.cookies.set(AI_COOKIE, "off", {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}
