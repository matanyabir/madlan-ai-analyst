import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { getSnapshot, snapshotOrigin } from "@/lib/snapshot";
import { isAiEnabled, llmKeyConfigured } from "@/lib/llm/client";
import { AdminUpload } from "@/components/AdminUpload";
import { AiToggle } from "@/components/AiToggle";
import { LogoutButton } from "@/components/LogoutButton";
import { formatCount, formatRange } from "@/components/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "ניהול נתונים — אנליסט הנדל״ן" };

/**
 * The admin area.
 *
 * proxy.ts already redirects an unauthenticated or non-admin visitor, but
 * this checks again. Next's docs are explicit that proxy is an optimistic
 * check and not the authorization boundary, and a page that trusts a
 * redirect it cannot see is a page that leaks the first time a matcher
 * config changes.
 */
export default async function AdminPage() {
  const session = await requireRole("admin");
  if (!session) redirect("/login?next=/admin");

  const snapshot = getSnapshot();
  const origin = snapshotOrigin();

  return (
    <>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">ניהול נתונים</h1>
              <p className="mt-1 text-sm text-muted">
                העלאת קובץ עסקאות, ניקוי אוטומטי, ויומן מלא של מה תוקן ומה נמצא.
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="ltr text-xs text-subtle">{session.email}</span>
              <Link href="/" className="text-accent hover:underline">לאנליסט</Link>
              <LogoutButton />
            </div>
          </div>

          <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <Stat label="מקור הנתונים">
              {origin.origin === "baked" ? "קובץ מקובע במאגר הקוד" : "הועלה בזמן ריצה"}
            </Stat>
            <Stat label="גרסה">
              <span className="ltr">{snapshot.version}</span>
            </Stat>
            <Stat label="עסקאות בניתוח">{formatCount(snapshot.counts.analyzable)}</Stat>
            <Stat label="תקופה">{formatRange(snapshot.dateRange)}</Stat>
          </dl>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-6 sm:px-6">
        <AiToggle initialEnabled={isAiEnabled()} keyConfigured={llmKeyConfigured()} />
        <AdminUpload currentVersion={snapshot.version} />
      </main>
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
