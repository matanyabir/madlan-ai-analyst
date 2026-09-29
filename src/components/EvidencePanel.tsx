import type { Evidence } from "@/lib/analysis";
import { formatCount, formatRange } from "./format";

/**
 * The evidence panel.
 *
 * Shown under every analytical answer, never collapsed away by default, and
 * never populated with a claim the result did not actually make. This is
 * where the product earns the right to be believed: sample size, period,
 * every active filter, how the metric is defined, and every row that was
 * excluded with the reason.
 */
export function EvidencePanel({ evidence }: { evidence: Evidence }) {
  const hasFilters = evidence.filters.length > 0;
  const hasExclusions = evidence.exclusions.length > 0;

  return (
    <section
      aria-label="על מה מבוססת התשובה"
      className="mt-6 rounded-xl border border-border bg-surface-muted/60 p-4 sm:p-5"
      data-testid="evidence"
    >
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
        <svg
          aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0"
          fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v4M8 4.9v.9" strokeLinecap="round" />
        </svg>
        על מה מבוססת התשובה
      </h3>

      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-subtle">מספר עסקאות</dt>
          <dd className="tnum text-base font-semibold" data-testid="evidence-count">
            {formatCount(evidence.transactionCount)}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-subtle">טווח תאריכים</dt>
          <dd className="text-base font-medium">{formatRange(evidence.dateRange)}</dd>
        </div>

        {hasFilters && (
          <div className="sm:col-span-2">
            <dt className="mb-1.5 text-xs text-subtle">סינון</dt>
            <dd className="flex flex-wrap gap-1.5">
              {evidence.filters.map((f, i) => (
                <span
                  key={`${f.label}-${i}`}
                  className="rounded-md bg-surface px-2 py-1 text-xs ring-1 ring-border"
                >
                  <span className="text-subtle">{f.label}:</span>{" "}
                  <span className="font-medium">{f.value}</span>
                </span>
              ))}
            </dd>
          </div>
        )}

        {evidence.metric && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-subtle">איך חושב</dt>
            <dd className="text-sm leading-relaxed text-muted">
              {evidence.metric.definition}
            </dd>
          </div>
        )}

        {hasExclusions && (
          <div className="sm:col-span-2">
            <dt className="mb-1.5 text-xs text-subtle">לא נכלל בחישוב</dt>
            <dd>
              <ul className="space-y-1 text-sm text-muted">
                {evidence.exclusions.map((e, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="tnum font-medium">{formatCount(e.count)}</span>
                    <span>{e.reason}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      {evidence.notes.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs leading-relaxed text-subtle">
          {evidence.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-subtle">
        גרסת נתונים <span className="ltr tnum">{evidence.snapshotVersion}</span>
      </p>
    </section>
  );
}
