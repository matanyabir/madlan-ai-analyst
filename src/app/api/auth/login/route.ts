import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticate, authConfigured, createSessionToken, SESSION_COOKIE,
} from "@/lib/auth/session";

/** scrypt needs Node, not Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
  next: z.string().max(200).optional(),
});

/**
 * Only same-origin paths may be used as a post-login redirect target, so a
 * crafted `next` cannot bounce a freshly authenticated user off-site.
 */
/**
 * A 303 with a *relative* Location.
 *
 * NextResponse.redirect() needs an absolute URL, and building one from
 * `request.url` uses Next's internally resolved host rather than the Host
 * the client actually used — so a visitor on 127.0.0.1 gets redirected to
 * localhost, which is a different origin, and the session cookie just set
 * for 127.0.0.1 is not sent with the follow-up request. The login silently
 * bounces back to the form.
 *
 * A relative Location (RFC 7231 §7.1.2) keeps the browser on whatever origin
 * it was already using.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function safeNext(next: string | undefined, role: "admin" | "user"): string {
  const fallback = role === "admin" ? "/admin" : "/";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (role !== "admin" && next.startsWith("/admin")) return "/";
  return next;
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "ההתחברות אינה מוגדרת בשרת. ראו .env.example" },
      { status: 503 },
    );
  }

  // Two callers: the hydrated client posts JSON, the plain HTML form posts
  // form-encoded. The second is what runs before hydration completes, and it
  // has to work -- otherwise the browser's default GET submit puts the
  // password in the URL.
  const contentType = request.headers.get("content-type") ?? "";
  const isFormPost = contentType.includes("form");

  let payload: unknown;
  try {
    if (isFormPost) {
      payload = Object.fromEntries(await request.formData());
    } else {
      payload = await request.json();
    }
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    if (isFormPost) return redirectTo("/login?error=1");
    return NextResponse.json({ error: "יש להזין אימייל וסיסמה" }, { status: 400 });
  }

  const session = authenticate(parsed.data.email, parsed.data.password);
  if (!session) {
    // One message for both wrong-email and wrong-password: the endpoint does
    // not reveal which accounts exist.
    if (isFormPost) return redirectTo("/login?error=1");
    return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
  }

  const token = await createSessionToken(session);
  const destination = safeNext(parsed.data.next, session.role);

  // 303 so the browser follows with a GET rather than re-posting.
  const response = isFormPost
    ? redirectTo(destination)
    : NextResponse.json({ email: session.email, role: session.role, next: destination });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
