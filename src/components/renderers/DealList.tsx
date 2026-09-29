"use client";

import { useState } from "react";
import type { DealCard } from "@/lib/analysis";
import { formatNis, formatDate, formatCount } from "../format";

/**
 * Transaction cards.
 *
 * Carries two optional overlays that the analysis engine attaches:
 *
 *   - `similarity`, from find_comparable_deals — expandable into the exact
 *     per-factor contributions, so "why is this here" has a real answer
 *     rather than a trust-me score.
 *   - `anomaly`, from find_anomalies — shown as a distance from the peer
 *     median, deliberately worded as unusual rather than wrong.
 */
export function DealList({ deals }: { deals: DealCard[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="deal-list">
      {deals.map((deal) => (
        <DealItem key={deal.key} deal={deal} />
      ))}
    </ul>
  );
}

function DealItem({ deal }: { deal: DealCard }) {
  const [showFactors, setShowFactors] = useState(false);

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {deal.street ?? "רחוב לא ידוע"}
            {deal.neighborhood ? `, ${deal.neighborhood}` : ""}
          </p>
          <p className="text-xs text-subtle">{deal.city}</p>
        </div>
        {deal.priceNis != null && (
          <p className="tnum shrink-0 text-lg font-bold">{formatNis(deal.priceNis)}</p>
        )}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {deal.propertyType && <Fact label="סוג">{deal.propertyType}</Fact>}
        {deal.rooms != null && <Fact label="חדרים">{deal.rooms}</Fact>}
        {deal.sizeSqm != null && <Fact label="שטח">{deal.sizeSqm} מ״ר</Fact>}
        {deal.floor != null && <Fact label="קומה">{deal.floor}</Fact>}
        {deal.pricePerSqm != null && (
          <Fact label="למ״ר">{formatNis(deal.pricePerSqm)}</Fact>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-xs text-subtle">
        {deal.dealDate && <span>{formatDate(deal.dealDate, deal.datePrecision)}</span>}
        {deal.datePrecision === "month" && (
          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">
            חודש בלבד
          </span>
        )}
        {deal.source && <span>מקור: {deal.source}</span>}
      </div>

      {deal.anomaly && (
        <div className="mt-3 rounded-lg bg-warning-soft p-2.5 text-xs leading-relaxed text-warning">
          <p className="font-semibold">
            חריגה סטטיסטית — {deal.anomaly.direction === "high" ? "גבוה" : "נמוך"} מהצפוי
          </p>
          <p className="tnum mt-0.5">
            חציון קבוצת ההשוואה: {formatNis(deal.anomaly.peerMedian)} למ״ר, לפי{" "}
            {formatCount(deal.anomaly.peerCount)} עסקאות דומות. מרחק{" "}
            {Math.abs(deal.anomaly.modifiedZ).toFixed(1)} סטיות חציוניות.
          </p>
        </div>
      )}

      {deal.similarity && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowFactors((v) => !v)}
            aria-expanded={showFactors}
            className="flex w-full items-center justify-between rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs transition-colors hover:bg-border/60"
          >
            <span className="text-muted">
              ציון דמיון{" "}
              <span className="tnum font-semibold text-foreground">
                {(deal.similarity.score * 100).toFixed(0)}%
              </span>
            </span>
            <span className="text-accent">{showFactors ? "הסתר" : "למה?"}</span>
          </button>

          {showFactors && (
            <ul className="mt-2 space-y-1.5">
              {deal.similarity.factors.map((f) => (
                <li key={f.label} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-subtle">{f.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <span
                      className="block h-full rounded-full bg-accent"
                      /* Contributions are fractions of 1.0 across all factors. */
                      style={{ width: `${Math.min(100, f.contribution * 100 * 3)}%` }}
                    />
                  </span>
                  <span className="tnum w-10 shrink-0 text-start text-subtle">
                    {(f.contribution * 100).toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="text-subtle">{label}:</dt>
      <dd className="tnum font-medium text-foreground">{children}</dd>
    </div>
  );
}
