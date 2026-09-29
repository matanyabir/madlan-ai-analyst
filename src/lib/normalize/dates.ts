import type { DatePrecision } from "@/lib/types";

/**
 * The CSV carries four date formats, one of which has no day at all.
 *
 *   yyyy-mm-dd   x373
 *   dd/mm/yyyy   x76
 *   dd.mm.yyyy   x55
 *   Mon yyyy     x26   <- no day
 *
 * Day-first (not month-first) is established from the data: across both the
 * slash and dot formats the first component reaches 28 while the second never
 * exceeds 12, which is only consistent with dd/mm.
 */

export interface DateParse {
  /** ISO yyyy-mm-dd. Day-less inputs become the 1st of the month. */
  iso: string | null;
  precision: DatePrecision | null;
  /** True when the source string was not already ISO. */
  reformatted: boolean;
  /** True when the source carried no day and one was assumed. */
  missingDay: boolean;
  unparseable: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const FAIL: DateParse = {
  iso: null,
  precision: null,
  reformatted: false,
  missingDay: false,
  unparseable: true,
};

const EMPTY: DateParse = {
  iso: null,
  precision: null,
  reformatted: false,
  missingDay: false,
  unparseable: false,
};

/** Rejects impossible calendar dates such as 31/02. */
function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDealDate(raw: string | undefined | null): DateParse {
  if (raw == null) return EMPTY;
  const v = raw.trim();
  if (v === "") return EMPTY;

  // yyyy-mm-dd
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) {
    const s = toIso(+iso[1], +iso[2], +iso[3]);
    return s
      ? { iso: s, precision: "day", reformatted: false, missingDay: false, unparseable: false }
      : FAIL;
  }

  // dd/mm/yyyy or dd.mm.yyyy
  const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(v);
  if (dmy) {
    const s = toIso(+dmy[3], +dmy[2], +dmy[1]);
    return s
      ? { iso: s, precision: "day", reformatted: true, missingDay: false, unparseable: false }
      : FAIL;
  }

  // "Aug 2025" — month precision only.
  const monthYear = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(v);
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (!month) return FAIL;
    const s = toIso(+monthYear[2], month, 1);
    return s
      ? { iso: s, precision: "month", reformatted: true, missingDay: true, unparseable: false }
      : FAIL;
  }

  return FAIL;
}

/** yyyy-mm bucket key. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** yyyy-Qn bucket key. */
export function quarterKey(iso: string): string {
  const month = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** Whole months between two ISO dates, used by the comparables recency decay. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = [Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7))];
  const [ty, tm] = [Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm);
}
