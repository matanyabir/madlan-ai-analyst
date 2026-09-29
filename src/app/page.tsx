import Link from "next/link";
import { getSnapshot } from "@/lib/snapshot";
import { Analyst } from "@/components/Analyst";
import { AiStatusBadge } from "@/components/AiStatusBadge";
import { llmAvailable } from "@/lib/llm/client";
import { formatCount, formatRange } from "@/components/format";

export const dynamic = "force-dynamic";

/**
 * The analyst page.
 *
 * A server component that reads the snapshot for the header figures and
 * hands the interactive part to a client component. The counts in the header
 * are the real ones from the pipeline, not copy — if an admin uploads a new
 * file, this header changes with it.
 */
export default function Home() {
  const snapshot = getSnapshot();
  const { counts, dateRange } = snapshot;

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                אנליסט הנדל״ן
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                שאלו בעברית על עסקאות שבוצעו. כל מספר בתשובה מחושב מהנתונים —
                מודל השפה מבין את השאלה ומנסח, ולא מחשב.
              </p>
            </div>
            <nav className="flex shrink-0 items-center gap-3 text-sm">
              <AiStatusBadge enabled={llmAvailable()} />
              <Link href="/browse" className="text-accent hover:underline">עיון</Link>
              <Link href="/admin" className="text-muted hover:underline">ניהול</Link>
            </nav>
          </div>

          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <Stat label="עסקאות בניתוח">{formatCount(counts.analyzable)}</Stat>
            <Stat label="ערים">{formatCount(snapshot.vocabulary.cities.length)}</Stat>
            <Stat label="תקופה">{formatRange(dateRange)}</Stat>
            <Stat label="הוצאו בניקוי">
              {formatCount(counts.quarantined + counts.conflictRowsHeldOut)}
            </Stat>
          </dl>
        </div>
      </header>

      <main className="flex-1">
        <Analyst dealCount={counts.analyzable} />
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-5 text-xs leading-relaxed text-subtle sm:px-6">
          המערכת מדווחת אך ורק על עסקאות שנמצאות במאגר זה, בתקופה שהוא מכסה.
          אין בה מידע על מצב השוק היום, על תחזיות, או על מאפייני שכונות מעבר
          לנתוני העסקאות עצמן.
        </div>
      </footer>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-semibold">{children}</dd>
    </div>
  );
}
