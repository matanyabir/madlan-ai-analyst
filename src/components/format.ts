import type { MetricCard } from "@/lib/analysis";

/**
 * Hebrew formatting.
 *
 * Intl with the he-IL locale, not hand-rolled string work: it gets the
 * thousands separator, the shekel sign placement and the month names right,
 * and it keeps the app consistent with how numbers appear elsewhere in
 * Israeli products.
 */

const nisFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

const plainFormatter = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

export function formatNis(value: number): string {
  return nisFormatter.format(value);
}

export function formatCount(value: number): string {
  return plainFormatter.format(value);
}

/** Large shekel amounts read better abbreviated on a card or an axis. */
export function formatNisShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `₪${decimalFormatter.format(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1_000) return `₪${plainFormatter.format(Math.round(value / 1_000))}K`;
  return formatNis(value);
}

export function formatMetric(value: number, unit: MetricCard["unit"]): string {
  switch (unit) {
    case "nis": return formatNis(value);
    case "nis_per_sqm": return `${formatNis(value)} / מ״ר`;
    case "sqm": return `${plainFormatter.format(value)} מ״ר`;
    case "rooms": return `${decimalFormatter.format(value)} חדרים`;
    case "percent": return `${decimalFormatter.format(value)}%`;
    case "count":
    case "year":
      return plainFormatter.format(value);
  }
}

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

const MONTHS_SHORT = [
  "ינו", "פבר", "מרץ", "אפר", "מאי", "יונ",
  "יול", "אוג", "ספט", "אוק", "נוב", "דצמ",
];

/** yyyy-mm-dd, honouring month-precision rows by omitting the invented day. */
export function formatDate(iso: string, precision?: "day" | "month" | null): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  if (precision === "month") return `${month} ${y}`;
  return `${Number(d)} ב${month} ${y}`;
}

/** Axis label for a "2025-03" or "2025-Q1" bucket key. */
export function formatPeriod(period: string): string {
  if (period.includes("Q")) {
    const [y, q] = period.split("-");
    return `${q.replace("Q", "רבעון ")}/${y.slice(2)}`;
  }
  const [y, m] = period.split("-");
  return `${MONTHS_SHORT[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

export function formatRange(range: { min: string; max: string } | null): string {
  if (!range) return "—";
  return `${formatDate(range.min, "month")} – ${formatDate(range.max, "month")}`;
}
