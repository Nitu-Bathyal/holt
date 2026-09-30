import { TipHost } from "./tip-host";
import { oddsSegments, oddsText, type CardStats, type SegmentKey } from "@/lib/repo-card";

// Merged is the good news, so it leads in green; the ways a pull request can
// go nowhere follow in warmer tones; "too recent to count" is left off the bar.
export const SEGMENT_CLASS: Record<SegmentKey, string> = {
  merged: "bg-green",
  replied: "bg-blue/50",
  other: "bg-faint/50",
  closed: "bg-amber",
  shut: "bg-faint/50",
  silent: "bg-orange",
  recent: "bg-transparent", // never drawn: the bar is the decided pull requests only
};

/** What happened to outside pull requests, as one thin stacked bar (words for screen readers). */
export function OddsBar({ stats, className = "h-1.5" }: { stats: CardStats; className?: string }) {
  // Pull requests too recent to count aren't an outcome, so the bar is only the decided ones and fills whole.
  const segs = oddsSegments(stats)?.filter((s) => s.key !== "recent");
  if (!segs?.length) return <div role="img" aria-label={oddsText(stats)} className={`${className} bg-panel-2`} />;
  return (
    <div role="img" aria-label={oddsText(stats)} className={`flex gap-px overflow-hidden bg-panel-2 ${className}`}>
      {segs.map((s) => (
        <span key={s.key} className={SEGMENT_CLASS[s.key]} style={{ flexGrow: s.n, flexBasis: 0, minWidth: s.n / stats.attempts! < 0.02 ? 3 : 0 }} />
      ))}
    </div>
  );
}

/** What the bar says, on hover or keyboard focus: every colour with its count. */
function OddsTip({ stats, segs }: { stats: CardStats; segs: { key: SegmentKey; n: number; label: string }[] }) {
  const recent = segs.find((s) => s.key === "recent");
  return (
    <>
      <p className="font-semibold text-ink">
        {stats.attempts} outside pull request{stats.attempts === 1 ? "" : "s"}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {segs.filter((s) => s.key !== "recent").map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`inline-block size-2 shrink-0 ${SEGMENT_CLASS[s.key]}`} />
            <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-ink">{s.n}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
      {recent && (
        <p className="mt-1.5 border-t border-line pt-1.5 text-faint">
          {recent.n} more {recent.n === 1 ? "is" : "are"} too recent to count.
        </p>
      )}
    </>
  );
}

/**
 * The odds bar for a card, marked instead of labelled: a flag over the end of
 * the green part says how many were merged, and hovering (or focusing) it lists
 * every colour with its count. It fills from the left as the card appears.
 */
export function OddsMeter({ stats }: { stats: CardStats }) {
  const segs = oddsSegments(stats);
  const words = oddsText(stats);
  if (!segs || !stats.attempts) {
    return (
      <div role="img" aria-label={words} title={words} className="odds-meter">
        <p className="text-[0.76rem] text-faint">No outside pull requests yet</p>
        <div className="mt-1.5 h-2 bg-panel-2" />
      </div>
    );
  }
  // As OddsBar: only decided pull requests, so the bar fills whole.
  const bar = segs.filter((s) => s.key !== "recent");
  const total = bar.reduce((a, s) => a + s.n, 0);
  const merged = segs.find((s) => s.key === "merged")?.n ?? 0;
  const at = (merged / total) * 100;
  const pct = Math.round((merged / stats.attempts) * 100);
  return (
    <TipHost label={words} tip={<OddsTip stats={stats} segs={segs} />} className="odds-meter group relative outline-none" style={{ ["--at" as string]: `${at}%` }}>
      {/* The flag slides with its tick but stays inside the card: at 0% its left edge is on the tick, at 100% its right edge. */}
      <div className="relative h-5">
        <span className="odds-flag absolute bottom-1 left-(--at) -translate-x-(--at) whitespace-nowrap text-[0.76rem] font-semibold text-green tabular-nums">
          {pct}% merged
        </span>
      </div>
      <div className="relative py-1 -my-1 group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-blue">
        <div className="odds-fill flex h-2 gap-px overflow-hidden bg-panel-2">
          {bar.map((s) => (
            <span key={s.key} className={SEGMENT_CLASS[s.key]} style={{ flexGrow: s.n, flexBasis: 0, minWidth: s.n / total < 0.02 ? 3 : 0 }} />
          ))}
        </div>
        <span aria-hidden="true" className="odds-flag absolute top-0 bottom-1 left-(--at) w-px -translate-x-1/2 bg-green" />
      </div>
    </TipHost>
  );
}
