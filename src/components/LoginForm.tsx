"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export function LoginForm() {
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
      /*
       * A full page load, not router.replace().
       *
       * Signing in changes server-rendered state on every route, and a soft
       * navigation can be served from Next's client-side router cache — so
       * the browser can land on a version of /admin rendered before the
       * session existed, get bounced by proxy.ts, and end up back on
       * /login?next=/admin looking like the login silently failed.
       * router.refresh() is meant to cover that but it is asynchronous and
       * races the navigation.
       *
       * location.assign discards the client cache entirely and issues a real
       * request carrying the cookie that was just set. It costs one page
       * load, on the one navigation in the app where correctness beats
       * smoothness.
       */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above: router.push/replace is the documented cause of this bug, not the fix.
      window.location.assign(body.next ?? (body.role === "admin" ? "/admin" : "/"));
    } catch {
      setError("לא הצלחנו להתחבר לשרת");
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
