"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import type { AskAnswer } from "@/lib/ask";
import { AnswerView } from "./AnswerView";

/** The five flows the product is built around, from the brief. */
const EXAMPLES = [
  'איך השתנה המחיר למ״ר ברמת גן?',
  "תשווה בין רמת גן לגבעתיים",
  'מצא לי עסקאות דומות לדירת 4 חדרים, 100 מ״ר ברמת גן',
  "כמה עסקאות של 4 חדרים יש בחיפה?",
  "מצא עסקאות חריגות",
];

const MAX_LENGTH = 400;

export function Analyst({ dealCount }: { dealCount: number }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Guards against an earlier slow response overwriting a later one. */
  const requestId = useRef(0);

  const submit = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (id !== requestId.current) return; // a newer question is in flight

      if (!res.ok) {
        setError(body.error ?? "אירעה שגיאה. נסו שוב.");
        setAnswer(null);
      } else {
        setAnswer(body as AskAnswer);
      }
    } catch {
      if (id !== requestId.current) return;
      setError("לא הצלחנו להתחבר לשרת. בדקו את החיבור ונסו שוב.");
      setAnswer(null);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [loading]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">
      <form
        onSubmit={(e) => { e.preventDefault(); void submit(question); }}
        className="sticky top-0 z-10 -mx-4 bg-background/90 px-4 pb-4 pt-4 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <label htmlFor="question" className="sr-only">
          שאלה על עסקאות הנדל״ן
        </label>
        <div className="relative rounded-2xl border border-border bg-surface shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <textarea
            id="question"
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(e) => {
              // Enter submits; Shift+Enter is a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
            rows={2}
            maxLength={MAX_LENGTH}
            placeholder="שאלו שאלה על עסקאות הנדל״ן..."
            className="w-full resize-none bg-transparent px-4 py-3.5 pe-28 text-[15px] outline-none placeholder:text-subtle"
            data-testid="question-input"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            data-testid="submit"
            className="absolute bottom-2.5 end-2.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          >
            {loading ? "מנתח..." : "שאלו"}
          </button>
        </div>
      </form>

      {!answer && !loading && !error && (
        <section aria-label="שאלות לדוגמה" className="mt-2">
          <p className="mb-3 text-sm text-muted">
            נסו אחת מאלה, או שאלו כל שאלה אחרת על{" "}
            <span className="tnum font-semibold text-foreground">{dealCount}</span> העסקאות שבמאגר:
          </p>
          <ul className="flex flex-col gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => { setQuestion(ex); void submit(ex); }}
                  data-testid="example-prompt"
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-start text-sm transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <AnswerSkeleton />}

      {error && !loading && (
        <div
          role="alert"
          data-testid="error"
          className="rounded-2xl border border-negative/25 bg-negative/5 p-5"
        >
          <p className="font-semibold text-negative">{error}</p>
          <p className="mt-1 text-sm text-muted">
            אפשר לנסח את השאלה מחדש, או לעיין בעסקאות ישירות בעמוד{" "}
            <Link href="/browse" className="font-medium text-accent underline">
              עיון בעסקאות
            </Link>
            .
          </p>
        </div>
      )}

      {answer && !loading && (
        <div className="space-y-4">
          <AnswerView answer={answer} />
          <button
            type="button"
            onClick={() => { setAnswer(null); setQuestion(""); inputRef.current?.focus(); }}
            className="text-sm text-muted underline hover:text-foreground"
          >
            שאלה חדשה
          </button>
        </div>
      )}
    </div>
  );
}

function AnswerSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-surface p-6"
      aria-busy="true"
      aria-live="polite"
      data-testid="loading"
    >
      <span className="sr-only">מנתח את השאלה</span>
      <div className="skeleton h-6 w-2/3 rounded-md" />
      <div className="skeleton mt-4 h-4 w-full rounded" />
      <div className="skeleton mt-2 h-4 w-5/6 rounded" />
      <div className="skeleton mt-6 h-32 w-full rounded-xl" />
    </div>
  );
}
