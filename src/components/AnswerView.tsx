"use client";

import type { AskAnswer } from "@/lib/ask";
import { EvidencePanel } from "./EvidencePanel";
import { Statistics } from "./renderers/Statistics";
import { TimeSeriesChart } from "./renderers/TimeSeriesChart";
import { Comparison } from "./renderers/Comparison";
import { DealList } from "./renderers/DealList";

/**
 * Renders one answer.
 *
 * The response type is chosen by the backend from the operation that ran, not
 * by the model, and this switch is exhaustive over that union — a new result
 * type is a TypeScript error here rather than a blank area in production.
 *
 * Nothing on this page renders model-authored markup. The model contributes
 * exactly one thing: the sentence in `summary`.
 */
export function AnswerView({ answer }: { answer: AskAnswer }) {
  const { result } = answer;

  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6" data-testid="answer">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold sm:text-xl" data-testid="answer-title">
          {result.title}
        </h2>
        {answer.degraded && <DegradedBadge reasons={answer.degradedReasons} />}
      </header>

      {/* The one model-authored string on the page. */}
      <p className="mb-5 text-[15px] leading-relaxed text-muted" data-testid="summary">
        {answer.summary}
      </p>

      {result.type === "statistics" && <Statistics metrics={result.metrics} />}

      {result.type === "timeSeries" && (
        <TimeSeriesChart
          points={result.points}
          metricLabel={result.metricLabel}
          unit={result.unit}
          granularity={result.granularity}
        />
      )}

      {result.type === "comparison" && (
        <Comparison items={result.items} metricLabel={result.metricLabel} unit={result.unit} />
      )}

      {result.type === "dealList" && <DealList deals={result.deals} />}

      {result.type === "propertyComparison" && (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="property-comparison">
          {[result.subject, ...result.others].map((p, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-2 font-semibold">{p.label}</p>
              <dl className="space-y-1 text-sm">
                {p.rows.map((r) => (
                  <div key={r.label} className="flex justify-between gap-3">
                    <dt className="text-subtle">{r.label}</dt>
                    <dd className="tnum font-medium">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {result.type === "text" && (
        <div
          className="rounded-xl border border-border bg-surface-muted p-4 text-[15px] leading-relaxed"
          data-testid="text-answer"
        >
          {result.body}
        </div>
      )}

      {result.type === "insufficient" && (
        <div
          className="rounded-xl border border-warning/25 bg-warning-soft p-4"
          data-testid="insufficient"
        >
          <p className="text-[15px] font-medium leading-relaxed text-warning">
            {result.message}
          </p>
        </div>
      )}

      <EvidencePanel evidence={result.evidence} />
    </article>
  );
}

const DEGRADED_COPY: Record<string, string> = {
  no_api_key: "מנוע השפה אינו מוגדר",
  ai_disabled: "מנוע השפה כובה ידנית",
  router_timeout: "מנוע השפה לא הגיב בזמן",
  router_error: "מנוע השפה החזיר שגיאה",
  router_no_tool_call: "מנוע השפה לא בחר ניתוח",
  router_invalid_arguments: "מנוע השפה החזיר פרמטרים שלא עברו אימות",
  narrator_unavailable: "ההסבר המילולי נוצר מתבנית קבועה",
};

/**
 * Says plainly that the model was not involved.
 *
 * The numbers are unaffected — they never come from the model — so the
 * wording is about the explanation, not about the answer's reliability.
 */
function DegradedBadge({ reasons }: { reasons: string[] }) {
  const detail = reasons.map((r) => DEGRADED_COPY[r] ?? r).join(" · ");
  return (
    <span
      title={detail}
      data-testid="degraded-badge"
      className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning"
    >
      מצב מצומצם — הנתונים מדויקים, ההסבר תבניתי
    </span>
  );
}
