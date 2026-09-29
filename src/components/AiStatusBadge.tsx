/**
 * Whether the language model is currently doing any work.
 *
 * Deliberately never says "AI is off" as though something were broken — the
 * product answers every question either way and the numbers are identical,
 * because they are computed in TypeScript and never by the model. The badge
 * describes *who wrote the explanation*, which is the only thing that
 * actually changes.
 */
export function AiStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      data-testid="ai-status-badge"
      data-enabled={enabled}
      title={
        enabled
          ? "מודל השפה מזהה את כוונת השאלה ומנסח את ההסבר. המספרים מחושבים בקוד בכל מקרה."
          : "מודל השפה אינו פעיל. השאלות מנותבות בהתאמת תבניות וההסברים נוצרים מתבניות קבועות. המספרים זהים לחלוטין."
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled
          ? "bg-accent-soft text-accent"
          : "bg-surface-muted text-muted ring-1 ring-border"
      }`}
    >
      <BotIcon muted={!enabled} />
      {enabled ? "מנוע שפה פעיל" : "מנוע שפה כבוי"}
    </span>
  );
}

function BotIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* head */}
      <rect x="2.5" y="5" width="11" height="8.5" rx="2.5" />
      {/* antenna */}
      <path d="M8 5V2.5" />
      <circle cx="8" cy="2" r="1" fill="currentColor" stroke="none" />
      {/* eyes — hollow when the model is not in use */}
      <circle cx="5.8" cy="9" r="0.9" fill={muted ? "none" : "currentColor"} stroke="none" />
      <circle cx="10.2" cy="9" r="0.9" fill={muted ? "none" : "currentColor"} stroke="none" />
      {muted && <circle cx="5.8" cy="9" r="0.9" />}
      {muted && <circle cx="10.2" cy="9" r="0.9" />}
    </svg>
  );
}
