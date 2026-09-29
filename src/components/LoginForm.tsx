"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("error") ? "אימייל או סיסמה שגויים" : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "ההתחברות נכשלה");
        return;
      }
      // Replace so Back does not land on the login form post-login.
      // The destination is the one the server vetted, not the raw ?next.
      router.replace(body.next ?? (body.role === "admin" ? "/admin" : "/"));
      router.refresh();
    } catch {
      setError("לא הצלחנו להתחבר לשרת");
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
     * action and method are the no-JavaScript fallback, and they are not
     * optional decoration.
     *
     * A <form> with neither one submits as a GET to the current URL, which
     * serialises the fields into the query string -- putting the password in
     * the address bar, in browser history and in server access logs. That is
     * exactly what happens whenever hydration has not completed: the React
     * onSubmit handler is not attached yet and the browser uses its default.
     *
     * Pointing the form at the real endpoint with method="post" means the
     * pre-hydration path is a working login rather than a credential leak.
     * The route handler detects a form-encoded body and answers with a
     * redirect instead of JSON.
     */
    <form
      action="/api/auth/login"
      method="post"
      onSubmit={submit}
      className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5"
      data-testid="login-form"
    >
      {/* Carries the return path through a no-JS submit. */}
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          אימייל
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="email"
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-start outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          סיסמה
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="password"
          className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-start outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {error && (
        <p role="alert" data-testid="login-error" className="text-sm font-medium text-negative">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        data-testid="login-submit"
        className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
      >
        {busy ? "מתחבר..." : "התחברות"}
      </button>
    </form>
  );
}
