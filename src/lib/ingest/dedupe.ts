import type { Deal, IngestIssue } from "@/lib/types";

/**
 * Fields that decide whether two rows sharing a deal_id describe the same
 * transaction. Deliberately excludes `raw`, `rowNumber` and `key`, and
 * compares *normalized* values — so two rows differing only by whitespace
 * ("  שמור " vs "שמור") are the same deal, while two rows reporting a
 * different price are not.
 */
const IDENTITY_FIELDS: (keyof Deal)[] = [
  "city", "neighborhood", "street", "propertyType", "condition",
  "rooms", "sizeSqm", "floor", "totalFloors", "yearBuilt",
  "hasElevator", "hasParking", "hasBalcony", "hasSafeRoom",
  "dealDate", "priceNis", "source",
];

function identitySignature(deal: Deal): string {
  return IDENTITY_FIELDS.map((f) => JSON.stringify(deal[f])).join("|");
}

/** Lists the fields on which two rows of the same deal_id disagree. */
function differingFields(a: Deal, b: Deal): (keyof Deal)[] {
  return IDENTITY_FIELDS.filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
}

export interface DedupeResult {
  deals: Deal[];
  issues: IngestIssue[];
  identicalCollapsed: number;
  conflictGroups: number;
  conflictRowsHeldOut: number;
}

/**
 * Resolves duplicate deal_ids.
 *
 * Two distinct problems hide behind one symptom:
 *
 *   - Six ids in the sample CSV appear twice with identical content. The
 *     second row carries no information; collapse it.
 *
 *   - Four ids report a *different price from a different source* — the same
 *     sale recorded once by רשות המסים and once by an agent or owner, 2-4%
 *     apart. There is no defensible rule for picking a winner, so both rows
 *     are kept, tagged with a shared conflictGroup, and marked unanalysable
 *     so a single transaction cannot be counted twice in a median.
 *
 * The spec forbids merging conflicting records merely because their ids
 * match. Preferring רשות המסים would be a reasonable product decision, but
 * it is not one this pipeline makes silently.
 */
export function dedupe(deals: Deal[]): DedupeResult {
  const byId = new Map<string, Deal[]>();
  for (const deal of deals) {
    const list = byId.get(deal.dealId);
    if (list) list.push(deal);
    else byId.set(deal.dealId, [deal]);
  }

  const out: Deal[] = [];
  const issues: IngestIssue[] = [];
  let identicalCollapsed = 0;
  let conflictGroups = 0;
  let conflictRowsHeldOut = 0;

  for (const [dealId, group] of byId) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    // Partition the group into sets of byte-equivalent rows.
    const bySignature = new Map<string, Deal[]>();
    for (const deal of group) {
      const sig = identitySignature(deal);
      const list = bySignature.get(sig);
      if (list) list.push(deal);
      else bySignature.set(sig, [deal]);
    }

    const distinct = [...bySignature.values()];

    // Collapse each set of identical rows down to its first occurrence.
    for (const identicalRows of distinct) {
      for (const dropped of identicalRows.slice(1)) {
        identicalCollapsed++;
        issues.push({
          rowNumber: dropped.rowNumber,
          dealId,
          field: "deal_id",
          type: "duplicate_identical",
          severity: "info",
          rawValue: dealId,
          resolvedValue: dealId,
          resolver: "deterministic",
          note: `שורה זהה לחלוטין לשורה ${identicalRows[0].rowNumber}. אוחדה`,
        });
      }
    }

    if (distinct.length === 1) {
      out.push(distinct[0][0]);
      continue;
    }

    // Genuinely conflicting: keep every variant, hold them all out.
    conflictGroups++;
    const survivors = distinct.map((rows) => rows[0]);
    const fields = differingFields(survivors[0], survivors[1]);
    const detail = fields
      .map((f) => `${f}: ${survivors.map((s) => JSON.stringify(s[f])).join(" / ")}`)
      .join("; ");

    survivors.forEach((deal, i) => {
      conflictRowsHeldOut++;
      out.push({
        ...deal,
        key: `${dealId}#${i + 1}`,
        conflictGroup: dealId,
        isAnalyzable: false,
      });
      issues.push({
        rowNumber: deal.rowNumber,
        dealId,
        field: fields.join(", "),
        type: "duplicate_conflict",
        severity: "error",
        rawValue: dealId,
        resolvedValue: null,
        resolver: "none",
        note:
          `אותו מזהה עסקה מדווח ביותר מגרסה אחת (${detail}). ` +
          `שתי הגרסאות נשמרו ואף אחת לא נכללת בסטטיסטיקות, כדי לא לספור עסקה אחת פעמיים`,
      });
    });
  }

  return { deals: out, issues, identicalCollapsed, conflictGroups, conflictRowsHeldOut };
}
