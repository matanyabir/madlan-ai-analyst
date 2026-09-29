import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets a client component learn who it is without exposing the token. */
export async function GET() {
  return NextResponse.json({ session: await currentSession() });
}
