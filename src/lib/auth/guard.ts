import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionToken, type Role, type Session } from "./session";

/**
 * The real authorization boundary.
 *
 * Next's own docs are explicit that Proxy (formerly Middleware) runs on
 * every route including prefetches and should be used for optimistic checks
 * only — never as the authorization solution. So proxy.ts redirects for UX,
 * and this runs inside the page and the route handler where the decision
 * actually matters.
 */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireRole(role: Role): Promise<Session | null> {
  const session = await currentSession();
  if (!session) return null;
  if (role === "admin" && session.role !== "admin") return null;
  return session;
}

/** For API routes: returns a 401/403 response, or null when authorized. */
export async function guardApi(role: Role): Promise<NextResponse | null> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }
  if (role === "admin" && session.role !== "admin") {
    return NextResponse.json({ error: "הפעולה מותרת למנהלים בלבד" }, { status: 403 });
  }
  return null;
}
