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
});

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "ההתחברות אינה מוגדרת בשרת. ראו .env.example" },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "יש להזין אימייל וסיסמה" }, { status: 400 });
  }

  const session = authenticate(parsed.data.email, parsed.data.password);
  if (!session) {
    // One message for both wrong-email and wrong-password: the endpoint does
    // not reveal which accounts exist.
    return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
  }

  const token = await createSessionToken(session);
  const response = NextResponse.json({ email: session.email, role: session.role });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
