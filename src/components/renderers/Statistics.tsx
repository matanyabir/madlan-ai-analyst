import type { MetricCard } from "@/lib/analysis";
import { formatMetric } from "../format";

/**
 * Metric cards.
 *
 * The first metric is the headline and gets the large treatment; the rest are
 * supporting. A count-only answer (the "how many deals" demo) therefore
 * renders as one big number, which is what that question deserves.
 */
export function Statistics({ metrics }: { metrics: MetricCard[] }) {
  const [headline, ...rest] = metrics;
  if (!headline) return null;

  return (
    <div data-testid="statistics">
      <div className="rounded-xl bg-accent-soft p-5 sm:p-6">
        <p className="text-sm font-medium text-accent">{headline.label}</p>
        <p
          className="tnum mt-1 text-4xl font-bold tracking-tight sm:text-5xl"
          data-testid="headline-metric"
        >
          {formatMetric(headline.value, headline.unit)}
        </p>
        {headline.hint && (
          <p className="mt-2 text-xs text-muted">{headline.hint}</p>
        )}
      </div>

      {rest.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rest.map((m) => (
            <div
              key={m.label}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <dt className="text-xs text-subtle">{m.label}</dt>
              <dd className="tnum mt-0.5 text-lg font-semibold">
                {formatMetric(m.value, m.unit)}
              </dd>
              {m.hint && <p className="mt-1 text-[11px] text-subtle">{m.hint}</p>}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
