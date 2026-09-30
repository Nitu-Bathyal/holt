import { oddsSegments, oddsText, type CardStats, type SegmentKey } from "@/lib/repo-card";

// Merged is the good news, so it leads in green; the ways a pull request can
// go nowhere follow in warmer tones; "too recent" is only hatched.
export const SEGMENT_CLASS: Record<SegmentKey, string> = {
  merged: "bg-green",
  replied: "bg-blue/50",
  other: "bg-faint/50",
  closed: "bg-amber",
  shut: "bg-faint/50",
  silent: "bg-orange",
  recent: "bg-[repeating-linear-gradient(135deg,var(--line-strong)_0_2px,transparent_2px_5px)]",
};

/** What happened to outside pull requests, as one thin stacked bar (words for screen readers). */
export function OddsBar({ stats, className = "h-1.5" }: { stats: CardStats; className?: string }) {
  const segs = oddsSegments(stats);
  if (!segs) return <div role="img" aria-label={oddsText(stats)} className={`${className} bg-panel-2`} />;
  // "Too recent" is context, not odds: it never takes more than a third of the bar.
  const decided = segs.reduce((a, s) => a + (s.key === "recent" ? 0 : s.n), 0);
  const width = (s: { key: string; n: number }) => (s.key === "recent" ? Math.min(s.n, decided / 2) : s.n);
  const total = segs.reduce((a, s) => a + width(s), 0);
  return (
    <div role="img" aria-label={oddsText(stats)} className={`flex gap-px overflow-hidden bg-panel-2 ${className}`}>
      {segs.map((s) => (
        <span key={s.key} className={SEGMENT_CLASS[s.key]} style={{ flexGrow: width(s), flexBasis: 0, minWidth: width(s) / total < 0.02 ? 3 : 0 }} />
      ))}
    </div>
  );
}

/** The bar's key, with counts: for the focus view. */
export function OddsLegend({ stats }: { stats: CardStats }) {
  const segs = oddsSegments(stats);
  if (!segs) return null;
  return (
    <ul aria-hidden="true" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[0.83rem] text-muted">
      {segs.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={`inline-block size-2.5 ${SEGMENT_CLASS[s.key]}`} />
          <span><span className="font-semibold text-ink tabular-nums">{s.n}</span> {s.label}</span>
        </li>
      ))}
    </ul>
  );
}
