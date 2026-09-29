"use client";

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, type TooltipContentProps,
} from "recharts";
import type { Granularity, MetricCard, SeriesPoint } from "@/lib/analysis";
import { formatMetric, formatPeriod, formatNisShort, formatCount } from "../format";

/**
 * Line chart for an ordered metric.
 *
 * Two RTL details worth knowing:
 *
 *   - The SVG stays LTR (see .recharts-wrapper in globals.css). Mirroring a
 *     chart inside an already-mirrored page double-flips it, and a time axis
 *     that runs right-to-left is not a convention anyone expects — a rising
 *     line should still mean "went up over time".
 *   - The Y axis is placed on the right (`orientation="right"`), which is the
 *     reading-side in Hebrew, without flipping the time direction.
 *
 * Gaps are gaps: a period with no transactions is absent from `points` and is
 * never interpolated across.
 */
const GRANULARITY_LABEL: Record<Granularity, string> = {
  month: "חודש", quarter: "רבעון", year: "שנה",
};

export function TimeSeriesChart({
  points, metricLabel, unit, granularity,
}: {
  points: SeriesPoint[];
  metricLabel: string;
  unit: MetricCard["unit"];
  granularity: Granularity;
}) {
  const data = points.map((p) => ({ ...p, label: formatPeriod(p.period) }));
  const sparseCount = points.filter((p) => p.sparse).length;

  return (
    <div data-testid="time-series">
      <div className="rounded-xl border border-border bg-surface p-4 pt-5">
        <p className="mb-4 text-sm font-medium text-muted">
          {metricLabel} · לפי {GRANULARITY_LABEL[granularity]}
        </p>

        <div className="h-[280px] w-full sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--subtle)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={16}
              />
              <YAxis
                orientation="right"
                tick={{ fontSize: 11, fill: "var(--subtle)" }}
                tickLine={false}
                axisLine={false}
                width={58}
                tickFormatter={(v: number) =>
                  unit === "count" ? formatCount(v) : formatNisShort(v)
                }
              />
              <Tooltip
                content={<SeriesTooltip unit={unit} metricLabel={metricLabel} />}
                cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2}
                dot={<SeriesDot />}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="mt-2 text-xs text-subtle">
        תקופות ללא עסקאות אינן מוצגות ואינן מושלמות בהשלמה גרפית.
        {sparseCount > 0 && (
          <>
            {" "}
            <span className="inline-block size-2 rounded-full bg-warning align-middle" />{" "}
            מסמן תקופה עם פחות מ-3 עסקאות.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Recharts 3 types custom tooltip content as TooltipContentProps rather than
 * TooltipProps -- the latter omits `payload`, which is read from context.
 * Those context props are injected at render time and are absent at the JSX
 * call site, so they are Partial here.
 */
type SeriesTooltipProps = Partial<TooltipContentProps<number, string>> & {
  unit: MetricCard["unit"];
  metricLabel: string;
};

/** A hollow amber dot marks a period too thin to read as a trend. */
function SeriesDot(props: { cx?: number; cy?: number; payload?: SeriesPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  return payload?.sparse ? (
    <circle cx={cx} cy={cy} r={3.5} fill="var(--surface)" stroke="var(--warning)" strokeWidth={1.75} />
  ) : (
    <circle cx={cx} cy={cy} r={2.5} fill="var(--accent)" />
  );
}

function SeriesTooltip({ active, payload, unit, metricLabel }: SeriesTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as SeriesPoint & { label: string };

  return (
    <div dir="rtl" className="rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-subtle">{point.label}</p>
      <p className="tnum text-sm font-semibold">
        {metricLabel}: {formatMetric(point.value, unit)}
      </p>
      {/* Sample size per point, so a spike on two deals is not read as a trend. */}
      <p className="tnum text-xs text-muted">מבוסס על {formatCount(point.n)} עסקאות</p>
      {point.sparse && (
        <p className="mt-0.5 text-xs text-warning">מעט מדי עסקאות לקביעת מגמה</p>
      )}
    </div>
  );
}
