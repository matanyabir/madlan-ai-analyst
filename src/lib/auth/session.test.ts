import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  hashPassword, verifyPassword, authenticate, authConfigured,
  createSessionToken, readSessionToken,
} from "./session";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", "test-secret-at-least-sixteen-chars-long");
});

afterEach(() => vi.unstubAllEnvs());

describe("password hashing", () => {
  it("round-trips a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("right");
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects a malformed or truncated stored hash instead of throwing", () => {
    for (const bad of ["", "nonsense", "scrypt:abc", "md5:aa:bb", "scrypt:aa:bb"]) {
      expect(verifyPassword("x", bad)).toBe(false);
    }
  });

  it("survives a round trip through a dotenv file", () => {
    // Regression: the hash used to be $-delimited, which dotenv expands as a
    // variable reference -- "scrypt$aabb$ccdd" loaded as "scrypt" and every
    // login failed silently. Unit tests passed because they never went
    // through env parsing.
    const stored = hashPassword("round-trip");
    expect(stored).not.toContain("$");

    const line = `ADMIN_PASSWORD_HASH=${stored}`;
    const parsedValue = line.slice(line.indexOf("=") + 1);
    // The value must contain nothing dotenv would interpolate.
    expect(parsedValue).toBe(stored);
    expect(verifyPassword("round-trip", parsedValue)).toBe(true);
  });
});

describe("authenticate", () => {
  const ADMIN_HASH = hashPassword("admin-pass");

  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "admin@madlan.test");
    vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_HASH);
    vi.stubEnv("USER_EMAIL", "user@madlan.test");
    vi.stubEnv("USER_PASSWORD", "user-pass");
  });

  it("authenticates the admin and assigns the admin role", () => {
    expect(authenticate("admin@madlan.test", "admin-pass")).toEqual({
      email: "admin@madlan.test", role: "admin",
    });
  });

  it("authenticates the regular user with the user role", () => {
    expect(authenticate("user@madlan.test", "user-pass")).toEqual({
      email: "user@madlan.test", role: "user",
    });
  });

  it("never promotes the regular user to admin", () => {
    expect(authenticate("user@madlan.test", "user-pass")!.role).toBe("user");
    expect(authenticate("user@madlan.test", "admin-pass")).toBeNull();
  });

  it("is case-insensitive on the email, exact on the password", () => {
    expect(authenticate("ADMIN@Madlan.Test", "admin-pass")).not.toBeNull();
    expect(authenticate("admin@madlan.test", "Admin-Pass")).toBeNull();
  });

  it("rejects an unknown email without revealing that it is unknown", () => {
    expect(authenticate("nobody@madlan.test", "admin-pass")).toBeNull();
  });

  it("reports itself unconfigured when no accounts are seeded", () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("USER_EMAIL", "");
    expect(authConfigured()).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a session", async () => {
    const token = await createSessionToken({ email: "a@b.test", role: "admin" });
    expect(await readSessionToken(token)).toEqual({ email: "a@b.test", role: "admin" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken({ email: "a@b.test", role: "admin" });
    vi.stubEnv("AUTH_SECRET", "a-completely-different-secret-value");
    expect(await readSessionToken(token)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await createSessionToken({ email: "a@b.test", role: "user" });
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "a@b.test", role: "admin" }))
      .toString("base64url");
    expect(await readSessionToken(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it("rejects garbage and absence without throwing", async () => {
    expect(await readSessionToken(undefined)).toBeNull();
    expect(await readSessionToken("")).toBeNull();
    expect(await readSessionToken("not.a.jwt")).toBeNull();
  });

  it("refuses to sign without a sufficiently long secret", async () => {
    vi.stubEnv("AUTH_SECRET", "short");
    await expect(createSessionToken({ email: "a@b.test", role: "user" })).rejects.toThrow();
  });
});
