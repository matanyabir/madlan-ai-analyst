"use client";

import { useState, useRef } from "react";
import type { IngestIssue, SnapshotCounts } from "@/lib/types";
import { IssueLog } from "./IssueLog";
import { formatCount, formatRange } from "./format";

interface UploadResult {
  version: string;
  sourceFile: string;
  counts: SnapshotCounts;
  dateRange: { min: string; max: string } | null;
  vocabulary: { cities: string[] };
  aiStats: {
    unresolvedValues: number;
    applied: number;
    flaggedForReview: number;
    refused: number;
    llmCalls: number;
  } | null;
  issues: IngestIssue[];
}

export function AdminUpload({ currentVersion }: { currentVersion: string }) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "העלאת הקובץ נכשלה");
      else setResult(body as UploadResult);
    } catch {
      setError("לא הצלחנו להעלות את הקובץ. בדקו את החיבור ונסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-border bg-surface"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <p className="text-sm font-medium">גררו לכאן קובץ CSV של עסקאות</p>
        <p className="mt-1 text-xs text-subtle">
          הקובץ ינותח, ינוקה, והבעיות שיימצאו יוצגו למטה לפני שהנתונים ייכנסו לשימוש
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          data-testid="choose-file"
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "מעבד..." : "בחירת קובץ"}
        </button>
      </div>

      {error && (
        <p role="alert" data-testid="upload-error"
           className="rounded-xl border border-negative/25 bg-negative/5 p-4 text-sm font-medium text-negative">
          {error}
        </p>
      )}

      {busy && (
        <div className="rounded-2xl border border-border bg-surface p-6" aria-busy="true">
          <div className="skeleton h-5 w-40 rounded" />
          <div className="skeleton mt-4 h-24 w-full rounded-xl" />
        </div>
      )}

      {result && (
        <div className="space-y-6" data-testid="upload-result">
          <section>
            <h2 className="mb-3 text-lg font-bold">תוצאת העיבוד</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Card label="שורות בקובץ" value={result.counts.rawRows} />
              <Card label="נכנסו לניתוח" value={result.counts.analyzable} tone="positive" />
              <Card label="כפילויות שאוחדו" value={result.counts.identicalDuplicatesCollapsed} />
              <Card
                label="כפילויות סותרות"
                value={result.counts.conflictRowsHeldOut}
                tone={result.counts.conflictRowsHeldOut ? "warning" : undefined}
                hint="נשמרו, לא אוחדו, ולא נכללות בסטטיסטיקות"
              />
              <Card
                label="הוצאו מהניתוח"
                value={result.counts.quarantined}
                tone={result.counts.quarantined ? "warning" : undefined}
                hint="נשמרו במלואן לצורך מעקב"
              />
            </dl>

            <p className="mt-3 text-xs text-subtle">
              <span className="ltr tnum">{result.sourceFile}</span> · גרסה{" "}
              <span className="ltr tnum">{result.version}</span> · {formatRange(result.dateRange)} ·{" "}
              {result.vocabulary.cities.length} ערים
            </p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold">נרמול בעזרת AI</h3>
            {result.aiStats ? (
              <div className="space-y-1 text-sm text-muted">
                <p>
                  נמצאו <strong className="text-foreground">{result.aiStats.unresolvedValues}</strong>{" "}
                  ערכים שכללי הנרמול הקבועים לא זיהו. הופנו למודל בקריאה אחת.
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  <li>✓ יושמו אוטומטית (ביטחון ≥85%): <strong>{result.aiStats.applied}</strong></li>
                  <li>⚠ יושמו ומסומנים לאימות (60–85%): <strong>{result.aiStats.flaggedForReview}</strong></li>
                  <li>✕ נדחו, השורות הוצאו מהניתוח: <strong>{result.aiStats.refused}</strong></li>
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">
                לא נדרשה התערבות של AI — כל הערכים בקובץ זוהו על ידי כללי הנרמול הקבועים.
                המודל נקרא רק כאשר נותרים ערכים לא מזוהים, ולכן העלאה נקייה אינה עולה דבר.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-warning/30 bg-warning-soft p-4">
            <h3 className="text-sm font-semibold text-warning">הנתונים פעילים — אך זמנית</h3>
            <p className="mt-1 text-xs leading-relaxed text-warning">
              הקובץ שהועלה הוא כעת מקור הנתונים של השרת הזה, וכל התשובות שבמטמון אופסו.
              מכיוון שאין בגרסה זו בסיס נתונים, השינוי אינו שורד הפעלה מחדש ואינו מגיע
              לשרתים אחרים. להנצחה: הורידו את קובץ הנתונים, שמרו אותו כ-
              <span className="ltr mx-1 font-mono">data/snapshot.json</span>
              ופרסמו מחדש.
            </p>
            <a
              href="/api/admin/snapshot"
              download
              data-testid="download-snapshot"
              className="mt-3 inline-block rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white"
            >
              הורדת קובץ הנתונים
            </a>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-bold">יומן בעיות ותיקונים</h2>
            <p className="mb-4 text-sm text-muted">
              כל שינוי שבוצע וכל בעיה שנמצאה, כולל השורה והערך המקורי.
            </p>
            <IssueLog issues={result.issues} />
          </section>
        </div>
      )}

      {!result && !busy && (
        <p className="text-xs text-subtle">
          מקור הנתונים הפעיל כרגע: גרסה{" "}
          <span className="ltr tnum">{currentVersion}</span>
        </p>
      )}
    </div>
  );
}

function Card({
  label, value, tone, hint,
}: {
  label: string;
  value: number;
  tone?: "positive" | "warning";
  hint?: string;
}) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "warning" ? "text-warning" : "";
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-subtle">{label}</p>
      <p className={`tnum mt-0.5 text-2xl font-bold ${toneClass}`}>{formatCount(value)}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-subtle">{hint}</p>}
    </div>
  );
}
