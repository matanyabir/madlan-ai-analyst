import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Minimal two-role auth.
 *
 * Deliberately small: the brief lists authentication among the things not to
 * spend time on, and the admin upload page is the only thing that needs
 * protecting. Two accounts seeded from environment variables, a signed
 * httpOnly cookie, no registration, no password reset, no user table.
 *
 * What it does *not* skimp on: scrypt rather than a bare hash, constant-time
 * comparison, a signed and expiring token, and an authorization check that
 * runs in the route handler rather than only in the proxy.
 */

export type Role = "admin" | "user";

export interface Session {
  email: string;
  role: Role;
}

export const SESSION_COOKIE = "madlan_session";
const SESSION_TTL = "12h";

const SCRYPT_KEYLEN = 64;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short (need 16+ characters)");
  }
  return new TextEncoder().encode(value);
}

// ------------------------------------------------------------- passwords

/**
 * `scrypt:<saltHex>:<hashHex>`. Produced by `npm run hash-password`.
 *
 * The separator is a colon, not the conventional `$`, and that is
 * deliberate: this value's destination is an environment file, and dotenv
 * expands `$NAME` as a variable reference. A `$`-delimited hash pasted into
 * .env.local silently loads as the literal string "scrypt" and every login
 * fails with no error anywhere. A credential format that cannot survive the
 * file it is designed to live in is the wrong format.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;

  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------- users

interface SeededUser {
  email: string;
  role: Role;
  /** Either a scrypt string or, for quick demo setup, a plaintext password. */
  secret: string;
  hashed: boolean;
}

function seededUsers(): SeededUser[] {
  const users: SeededUser[] = [];

  const add = (role: Role, email?: string, hash?: string, plain?: string) => {
    if (!email) return;
    if (hash) users.push({ email: email.toLowerCase(), role, secret: hash, hashed: true });
    else if (plain) users.push({ email: email.toLowerCase(), role, secret: plain, hashed: false });
  };

  add("admin", process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD_HASH, process.env.ADMIN_PASSWORD);
  add("user", process.env.USER_EMAIL, process.env.USER_PASSWORD_HASH, process.env.USER_PASSWORD);

  return users;
}

/**
 * Checks credentials against the seeded accounts.
 *
 * Runs the scrypt comparison even when the email is unknown, so a wrong
 * email and a wrong password take the same time and the endpoint does not
 * leak which accounts exist.
 */
export function authenticate(email: string, password: string): Session | null {
  const users = seededUsers();
  const candidate = users.find((u) => u.email === email.trim().toLowerCase());

  if (!candidate) {
    // Constant-ish work on the miss path.
    hashPassword(password);
    return null;
  }

  const ok = candidate.hashed
    ? verifyPassword(password, candidate.secret)
    : timingSafeEqual(
        Buffer.from(password.padEnd(64).slice(0, 64)),
        Buffer.from(candidate.secret.padEnd(64).slice(0, 64)),
      );

  return ok ? { email: candidate.email, role: candidate.role } : null;
}

export function authConfigured(): boolean {
  return seededUsers().length > 0 && Boolean(process.env.AUTH_SECRET);
}

// -------------------------------------------------------------- tokens

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.email)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

/** Returns null for anything not a currently-valid token. */
export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const role = payload.role;
    if (typeof payload.sub !== "string") return null;
    if (role !== "admin" && role !== "user") return null;
    return { email: payload.sub, role };
  } catch {
    return null;
  }
}
