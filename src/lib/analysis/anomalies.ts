import type { Deal } from "@/lib/types";
import { median, modifiedZScores, ANOMALY_THRESHOLD } from "./stats";

/**
 * Anomaly detection.
 *
 * "חריגה" means exactly one thing here: the deal's price per m² is far from
 * the median of a *comparable peer group*, measured in median-absolute
 * deviations. It does not mean the record is wrong, and no copy in this app
 * may imply that — a genuinely unusual sale is still a real sale.
 *
 * Peer group: same city and room count (rounded to the nearest half room),
 * requiring at least MIN_PEERS members. Below that the population is too
 * small to say anything and the deal is simply not judged.
 */
export const MIN_PEERS = 8;

export interface AnomalyHit {
  deal: Deal;
  modifiedZ: number;
  peerMedian: number;
  peerCount: number;
  direction: "high" | "low";
}

function peerKey(deal: Deal): string | null {
  if (!deal.city || deal.rooms == null) return null;
  return `${deal.city}|${deal.rooms}`;
}

export interface AnomalyOutcome {
  hits: AnomalyHit[];
  /** Deals that could not be judged, and why — surfaced in the evidence. */
  unjudged: { reason: string; count: number }[];
  peerGroupsUsed: number;
}

export function findAnomalies(pool: Deal[], limit: number): AnomalyOutcome {
  const eligible = pool.filter(
    (d) => d.isAnalyzable && d.pricePerSqm != null && peerKey(d) !== null,
  );

  const groups = new Map<string, Deal[]>();
  for (const d of eligible) {
    const k = peerKey(d)!;
    const list = groups.get(k);
    if (list) list.push(d);
    else groups.set(k, [d]);
  }

  const hits: AnomalyHit[] = [];
  let tooSmall = 0;
  let noSpread = 0;
  let peerGroupsUsed = 0;

  for (const members of groups.values()) {
    if (members.length < MIN_PEERS) {
      tooSmall += members.length;
      continue;
    }
    const values = members.map((d) => d.pricePerSqm!);
    const zs = modifiedZScores(values);

    if (zs.every(Number.isNaN)) {
      // MAD of zero: every deal in the group has the same price per m².
      noSpread += members.length;
      continue;
    }
    peerGroupsUsed++;
    const groupMedian = median(values);

    members.forEach((deal, i) => {
      const z = zs[i];
      if (!Number.isNaN(z) && Math.abs(z) >= ANOMALY_THRESHOLD) {
        hits.push({
          deal,
          modifiedZ: z,
          peerMedian: groupMedian,
          peerCount: members.length,
          direction: z > 0 ? "high" : "low",
        });
      }
    });
  }

  const unjudged: { reason: string; count: number }[] = [];
  if (tooSmall) {
    unjudged.push({
      reason: `עסקאות בקבוצות השוואה קטנות מ-${MIN_PEERS} עסקאות`,
      count: tooSmall,
    });
  }
  if (noSpread) unjudged.push({ reason: "קבוצות השוואה ללא פיזור מחירים", count: noSpread });

  hits.sort((a, b) => Math.abs(b.modifiedZ) - Math.abs(a.modifiedZ));
  return { hits: hits.slice(0, limit), unjudged, peerGroupsUsed };
}
