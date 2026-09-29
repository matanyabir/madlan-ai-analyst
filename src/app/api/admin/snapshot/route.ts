import { NextResponse } from "next/server";
import { guardApi } from "@/lib/auth/guard";
import { getSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the active snapshot.
 *
 * This is how an upload becomes permanent without a database: the admin
 * commits the downloaded file to data/snapshot.json and redeploys. Ugly, and
 * honest about it — see the README on replacing this with Postgres.
 */
export async function GET() {
  const denied = await guardApi("admin");
  if (denied) return denied;

  const snapshot = getSnapshot();
  return new NextResponse(JSON.stringify(snapshot), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="snapshot-${snapshot.version}.json"`,
    },
  });
}
