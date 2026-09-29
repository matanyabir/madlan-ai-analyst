"use client";

import { useMemo, useState } from "react";
import type { IngestIssue, IssueSeverity } from "@/lib/types";
import { formatCount } from "./format";

/**
 * The problem-and-fix log.
 *
 * Every transformation the pipeline applied and every defect it found, in
 * one filterable table. This is the answer to "what was wrong with the CSV
 * and what did you do about it" — demonstrable rather than described.
 */

const TYPE_LABELS: Record<string, string> = {
  whitespace_trimmed: "רווחים מיותרים",
  city_alias_applied: "שם עיר אוחד",
  city_unresolved: "עיר לא מזוהה",
  rooms_suffix_stripped: 'הוסר "חדרים" מהערך',
  date_reformatted: "פורמט תאריך הומר",
  date_missing_day: "תאריך ללא יום",
  date_unparseable: "תאריך לא קריא",
  price_separators_stripped: "הופרדו אלפים במחיר",
  price_currency_symbol_stripped: "הוסר סימן ₪ מהמחיר",
  price_derived: "מחיר שוחזר מחישוב",
  price_missing: "מחיר חסר",
  price_zero: "מחיר אפס",
  price_implausible: "מחיר לא סביר",
  price_per_sqm_conflict: "סתירה במחיר למ״ר",
  missing_value: "ערך חסר",
  unparseable_number: "מספר לא קריא",
  duplicate_identical: "כפילות זהה — אוחדה",
  duplicate_conflict: "כפילות סותרת — לא אוחדה",
  ai_canonicalized: "זוהה על ידי AI",
  ai_rejected: "AI לא הצליח לזהות",
};

const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  error: "bg-negative/10 text-negative",
  warning: "bg-warning-soft text-warning",
  info: "bg-surface-muted text-muted",
};

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: "שגיאה", warning: "אזהרה", info: "תיקון",
};

const PAGE_SIZE = 50;

export function IssueLog({ issues }: { issues: IngestIssue[] }) {
  const [severity, setSeverity] = useState<IssueSeverity | "all">("all");
  const [type, setType] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) m.set(i.type, (m.get(i.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  const filtered = useMemo(
    () =>
      issues.filter(
        (i) => (severity === "all" || i.severity === severity) && (type === "all" || i.type === type),
      ),
    [issues, severity, type],
  );

  const visible = filtered.slice(0, limit);

  return (
    <section data-testid="issue-log">
      <div className="mb-4 flex flex-wrap gap-2">
        <Filter
          value={severity}
          onChange={(v) => { setSeverity(v as IssueSeverity | "all"); setLimit(PAGE_SIZE); }}
          label="חומרה"
          options={[
            { value: "all", label: `הכול (${formatCount(issues.length)})` },
            ...(["error", "warning", "info"] as const).map((s) => ({
              value: s,
              label: `${SEVERITY_LABEL[s]} (${formatCount(issues.filter((i) => i.severity === s).length)})`,
            })),
          ]}
        />
        <Filter
          value={type}
          onChange={(v) => { setType(v); setLimit(PAGE_SIZE); }}
          label="סוג"
          options={[
            { value: "all", label: "כל הסוגים" },
            ...typeCounts.map(([t, n]) => ({
              value: t,
              label: `${TYPE_LABELS[t] ?? t} (${formatCount(n)})`,
            })),
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
          אין רשומות התואמות את הסינון.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] border-collapse bg-surface text-sm">
              <thead className="bg-surface-muted text-start text-xs text-subtle">
                <tr>
                  <Th>שורה</Th>
                  <Th>מזהה עסקה</Th>
                  <Th>שדה</Th>
                  <Th>מה נמצא</Th>
                  <Th>ערך במקור</Th>
                  <Th>אחרי תיקון</Th>
                  <Th>מקור ההחלטה</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((issue, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <Td className="tnum text-subtle">{issue.rowNumber || "—"}</Td>
                    <Td className="ltr tnum text-xs">{issue.dealId || "—"}</Td>
                    <Td className="ltr text-xs text-muted">{issue.field}</Td>
                    <Td>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[issue.severity]}`}
                      >
                        {TYPE_LABELS[issue.type] ?? issue.type}
                      </span>
                      {issue.note && (
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-subtle">
                          {issue.note}
                        </p>
                      )}
                    </Td>
                    <Td className="max-w-[160px] truncate font-mono text-xs text-muted">
                      {issue.rawValue === "" ? "(ריק)" : issue.rawValue}
                    </Td>
                    <Td className="max-w-[160px] truncate font-mono text-xs">
                      {issue.resolvedValue ?? "—"}
                    </Td>
                    <Td>
                      {issue.resolver === "ai" ? (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                          AI
                          {issue.confidence != null &&
                            ` · ${(issue.confidence * 100).toFixed(0)}%`}
                        </span>
                      ) : issue.resolver === "deterministic" ? (
                        <span className="text-xs text-subtle">כלל קבוע</span>
                      ) : (
                        <span className="text-xs text-subtle">לא טופל</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > visible.length && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              className="mt-3 w-full rounded-lg border border-border bg-surface py-2 text-sm text-accent hover:bg-accent-soft"
            >
              הצג עוד ({formatCount(filtered.length - visible.length)} נותרו)
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Filter({
  value, onChange, label, options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-subtle">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-start font-medium">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
