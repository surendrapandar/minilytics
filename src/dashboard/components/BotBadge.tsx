const REASONS: Record<string, string> = {
  datacenter: 'Came from a cloud or hosting network',
  no_origin: 'Not sent by a browser',
  no_engagement: 'No mouse, touch or typing',
};

/** Marks a visitor or visit that looks automated; the reason shows on hover. */
export function BotBadge({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;
  return (
    <span
      title={REASONS[reason] ?? reason}
      className="rounded-md border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    >
      Likely bot
    </span>
  );
}

/** Why a visit (session row) looks automated, or null for a person. */
export const sessionBotReason = (s: { bot?: string | null; engaged?: number }) => s.bot ?? (s.engaged === 0 ? 'no_engagement' : null);
