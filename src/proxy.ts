import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/auth/session";

/**
 * Optimistic route protection.
 *
 * Renamed from middleware.ts in Next 16. Per Next's own guidance this reads
 * the session cookie and nothing else — no database, no slow work — because
 * it runs on every request including prefetches. It is a redirect for the
 * user's benefit, NOT the authorization boundary; that lives in
 * lib/auth/guard.ts and runs in the page and route handler.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const login = new URL("/login", request.nextUrl);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (session.role !== "admin") {
    return NextResponse.redirect(new URL("/?denied=admin", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
