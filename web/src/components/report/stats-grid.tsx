import { statLines } from "@/lib/format";
import { fullStats, oddsSegments } from "@/lib/repo-card";
import type { Stats } from "@/lib/types";
import { CountUp, CountUpGroup } from "../motion/count-up";
import { OddsBar, SEGMENT_CLASS } from "../repo-card/odds-bar";
import { TONE } from "./tone";

/**
 * What happened to outside pull requests, as one card: the outcome bar and its
 * key on top (merged, replied, closed, no reply: the whole story in a glance),
 * and the figures under it in a divided grid, each with a thin meter where it
 * is a share. `limit` keeps the first few figures and leaves the bar off (the
 * badge page). Every number is Holt's own count; nothing is added here.
 * `reveal`: the figures step in (60ms, then 50ms apart), for a report that just arrived.
 * `land`: and once on screen, their numbers count up while the meters fill.
 */
export function StatsGrid({ stats, limit, reveal, land }: { stats: Partial<Stats>; limit?: number; reveal?: boolean; land?: boolean }) {
  const lines = statLines(stats).slice(0, limit);
  const segs = limit == null && stats.outsider_attempts != null ? oddsSegments(fullStats(stats as Stats)) : null;
  const decided = segs?.filter((s) => s.key !== "recent") ?? [];
  const card = (
    <div className="border border-line bg-panel shadow-soft" data-stats>
      {segs && decided.length > 0 && (
        <div className="border-b border-line px-4 py-3" data-odds>
          <p className="mb-2 text-[0.78rem] uppercase tracking-[0.08em] text-faint">What happened to outside pull requests</p>
          <OddsBar stats={fullStats(stats as Stats)} className="h-2.5 rounded-full" />
          <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 font-sans text-[0.8rem] text-muted">
            {decided.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2 rounded-full ${SEGMENT_CLASS[s.key]}`} />
                <span className="font-semibold tabular-nums text-ink">{s.n}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-hidden">
        <ul className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3">
          {lines.map((s, i) => {
            const t = TONE[s.tone];
            const delay = 120 + Math.min(i, 5) * 90;
            return (
              <li
                key={s.key}
                className={`border-b border-r border-line px-4 py-3 ${reveal ? "reveal" : ""}`}
                style={reveal ? { ["--d0" as string]: "60ms", ["--i" as string]: i } : undefined}
              >
                <p className={`text-[1.2rem] font-semibold leading-tight tracking-tight ${s.tone === "neutral" ? "text-ink" : t.text}`}>
                  {land ? <CountUp text={s.big} delay={delay} /> : s.big}
                </p>
                <p className="mt-0.5 font-sans text-[0.8rem] leading-snug text-muted">{s.label}</p>
                {s.meter != null && (
                  <div className="meter mt-2 !h-[3px]" aria-hidden="true">
                    <span className={t.bg} style={{ width: `${Math.max(2, Math.round(s.meter * 100))}%`, ...(land ? { ["--d" as string]: `${delay}ms` } : {}) }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
  return land ? <CountUpGroup>{card}</CountUpGroup> : card;
}
