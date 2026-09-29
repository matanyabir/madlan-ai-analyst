import { getSnapshot } from "@/lib/snapshot";
import { searchTransactions, getStatistics, type DealFilter } from "@/lib/analysis";
import { DealList } from "@/components/renderers/DealList";
import { EvidencePanel } from "@/components/EvidencePanel";
import { formatMetric } from "@/components/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "עיון בעסקאות — אנליסט הנדל״ן" };

/**
 * The no-model path.
 *
 * Plain filters, rendered on the server, reachable whether or not Claude is
 * configured or reachable. It is what the error state links to, and it is
 * the honest answer to "what does the product do when the model is down" —
 * something useful, not an apology.
 *
 * Deliberately a GET form with URL state: no JavaScript required, every view
 * is linkable, and there is no client bundle to fail.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const snapshot = getSnapshot();
  const v = snapshot.vocabulary;

  const one = (k: string) => {
    const raw = params[k];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value !== "" ? value : undefined;
  };
  const num = (k: string) => {
    const value = one(k);
    if (value == null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  // Every value is validated against the snapshot's own vocabulary, so a
  // hand-edited query string cannot inject a filter that does not exist.
  const city = v.cities.includes(one("city") ?? "") ? one("city") : undefined;
  const propertyType = v.propertyTypes.includes(one("type") ?? "") ? one("type") : undefined;
  const rooms = num("rooms");

  const filters: DealFilter = {
    ...(city ? { city } : {}),
    ...(propertyType ? { propertyType } : {}),
    ...(rooms != null ? { roomsMin: rooms, roomsMax: rooms } : {}),
  };

  const list = searchTransactions(snapshot, filters, 30, "recent");
  const stats = getStatistics(snapshot, filters, "price_per_sqm");

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">עיון בעסקאות</h1>
              <p className="mt-1 text-sm text-muted">
                סינון ישיר במאגר, ללא מודל שפה. העמוד הזה עובד גם כשהמודל אינו זמין.
              </p>
            </div>
            <a href="/" className="shrink-0 text-sm text-accent hover:underline">
              לאנליסט
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
        <form
          method="GET"
          className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4"
          data-testid="browse-filters"
        >
          <Select name="city" label="עיר" value={city} options={v.cities} />
          <Select name="type" label="סוג נכס" value={propertyType} options={v.propertyTypes} />
          <Select
            name="rooms"
            label="חדרים"
            value={rooms != null ? String(rooms) : undefined}
            options={v.roomOptions.map(String)}
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            סינון
          </button>
          <a href="/browse" className="py-2 text-sm text-muted hover:underline">
            ניקוי
          </a>
        </form>

        {stats.type === "statistics" && (
          <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.metrics.slice(0, 4).map((m) => (
              <div key={m.label} className="rounded-lg border border-border bg-surface p-3">
                <dt className="text-xs text-subtle">{m.label}</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold">
                  {formatMetric(m.value, m.unit)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {list.type === "dealList" ? (
          <>
            <DealList deals={list.deals} />
            <EvidencePanel evidence={list.evidence} />
          </>
        ) : (
          <p
            className="rounded-xl border border-warning/25 bg-warning-soft p-5 text-sm font-medium text-warning"
            data-testid="browse-empty"
          >
            לא נמצאו עסקאות התואמות את הסינון.
          </p>
        )}
      </main>
    </>
  );
}

function Select({
  name, label, value, options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-subtle">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="min-w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground"
      >
        <option value="">הכול</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
