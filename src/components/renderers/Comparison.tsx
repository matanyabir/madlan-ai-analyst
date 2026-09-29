"use client";

import type { MetricCard } from "@/lib/analysis";
import { formatMetric, formatCount } from "../format";

/**
 * Location comparison.
 *
 * A horizontal bar per location, drawn with CSS rather than a chart library:
 * two to four bars need no SVG, and a plain div respects RTL natively so the
 * bars grow from the right like the text does.
 *
 * Every bar carries its own sample size, because a comparison between a city
 * with 29 deals and one with 5 is not the same claim as one between equals.
 */
export function Comparison({
  items, metricLabel, unit,
}: {
  items: { label: string; value: number; n: number }[];
  metricLabel: string;
  unit: MetricCard["unit"];
}) {
  const max = Math.max(...items.map((i) => i.value));
  const leader = items[0];
  const trailer = items[items.length - 1];
  const gapPct = trailer.value ? ((leader.value / trailer.value - 1) * 100) : 0;

  return (
    <div data-testid="comparison">
      <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <p className="mb-4 text-sm font-medium text-muted">{metricLabel}</p>

        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="tnum text-sm font-semibold">
                  {formatMetric(item.value, unit)}
                </span>
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
                role="img"
                aria-label={`${item.label}: ${formatMetric(item.value, unit)}`}
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${max ? (item.value / max) * 100 : 0}%` }}
                />
              </div>
              <p className="tnum mt-1 text-xs text-subtle">
                {formatCount(item.n)} עסקאות
              </p>
            </li>
          ))}
        </ul>
      </div>

      {items.length === 2 && Number.isFinite(gapPct) && (
        <p className="mt-3 rounded-lg bg-surface-muted px-4 py-2.5 text-sm text-muted">
          <span className="font-semibold text-foreground">{leader.label}</span> גבוה ב-
          <span className="tnum font-semibold text-foreground">
            {Math.abs(gapPct).toFixed(0)}%
          </span>{" "}
          מ<span className="font-semibold text-foreground">{trailer.label}</span>{" "}
          בעסקאות שנמצאו במאגר.
        </p>
      )}
    </div>
  );
}
