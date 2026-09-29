"use client";

import { useState } from "react";

/**
 * Runtime kill switch for the model.
 *
 * Switching it off does not break the product — every question is still
 * answered, by the deterministic router and the template narrator, and the
 * answers carry a badge saying the explanation is templated. The numbers are
 * unaffected either way, because they never come from the model.
 *
 * That is the point of having it here rather than only as an env var: it
 * turns "the product survives the model being unavailable" from a claim in
 * the README into something a visitor can try in two clicks.
 */
export function AiToggle({
  initialEnabled,
  keyConfigured,
}: {
  initialEnabled: boolean;
  keyConfigured: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "השינוי נכשל");
        return;
      }
      setEnabled(body.enabled);
      // Server-rendered pages read this from the cookie, so they must be
      // re-fetched rather than served from the client router cache.
      window.location.reload();
    } catch {
      setError("לא הצלחנו לעדכן את ההגדרה");
    } finally {
      setBusy(false);
    }
  }

  // Nothing to toggle if the server has no key at all.
  if (!keyConfigured) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4" data-testid="ai-toggle">
        <h3 className="text-sm font-semibold">מנוע שפה</h3>
        <p className="mt-1 text-sm text-muted">
          לא הוגדר מפתח API בשרת. המערכת פועלת כולה במסלול הדטרמיניסטי:
          הניתוב נעשה בהתאמת תבניות והניסוח מתבניות קבועות. כל המספרים מדויקים —
          הם לעולם לא מגיעים מהמודל.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" data-testid="ai-toggle">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-56 flex-1">
          <h3 className="text-sm font-semibold">מנוע שפה</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {enabled
              ? "פעיל. המודל מזהה את כוונת השאלה ומנסח את ההסבר בעברית."
              : "כבוי. השאלות מנותבות בהתאמת תבניות וההסברים נוצרים מתבניות קבועות."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            כיבוי אינו משבית את המוצר — כל שאלה עדיין נענית, והמספרים זהים
            לחלוטין כי הם מחושבים בקוד ולא על ידי המודל. מה שמשתנה הוא איכות
            הזיהוי של ניסוחים חריגים ואיכות הניסוח.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="הפעלה או כיבוי של מנוע השפה"
          disabled={busy}
          onClick={toggle}
          data-testid="ai-toggle-button"
          data-enabled={enabled}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-positive" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-1 size-6 rounded-full bg-surface shadow transition-[inset-inline-start] ${
              enabled ? "start-7" : "start-1"
            }`}
          />
        </button>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-testid="ai-state"
          className={`rounded px-2 py-0.5 font-semibold ${
            enabled ? "bg-positive/10 text-positive" : "bg-warning-soft text-warning"
          }`}
        >
          {busy ? "מעדכן..." : enabled ? "מנוע שפה פעיל" : "מנוע שפה כבוי"}
        </span>
        <span className="text-subtle">
          ההגדרה נשמרת בדפדפן זה ומלווה כל בקשה ממנו. היא אינה משפיעה על
          משתמשים אחרים — הגדרה כלל-סביבתית דורשת אחסון משותף, כמו בסיס הנתונים
          שמתועד כשלב הבא.
        </span>
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
