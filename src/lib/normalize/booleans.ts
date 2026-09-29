/**
 * The four flag columns use eight different representations between them:
 * כן / לא / yes / no / TRUE / FALSE / 1 / 0.
 */

const TRUE_FORMS = new Set(["כן", "yes", "true", "1", "y", "כ"]);
const FALSE_FORMS = new Set(["לא", "no", "false", "0", "n"]);

/**
 * Returns tri-state. Missing is deliberately `null`, not `false`:
 * "we don't know whether this flat has parking" and "this flat has no
 * parking" are different facts, and 20 rows have an empty has_parking.
 * Collapsing them would silently corrupt any filtered count.
 */
export function parseBoolean(raw: string | undefined | null): boolean | null {
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (v === "") return null;
  if (TRUE_FORMS.has(v)) return true;
  if (FALSE_FORMS.has(v)) return false;
  return null;
}

/** Distinguishes "absent" from "present but unrecognised", which is a data bug. */
export function isUnrecognisedBoolean(raw: string | undefined | null): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v !== "" && !TRUE_FORMS.has(v) && !FALSE_FORMS.has(v);
}
