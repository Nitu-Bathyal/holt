import { statLines } from "@/lib/format";
import type { Stats } from "@/lib/types";
import { CountUp, CountUpGroup } from "../motion/count-up";
import { TONE } from "./tone";

/**
 * `reveal`: the tiles step in (60ms, then 50ms apart), for a report that just arrived.
 * `land`: and once on screen, their numbers count up while the meters fill.
 */
export function StatsGrid({ stats, limit, reveal, land }: { stats: Partial<Stats>; limit?: number; reveal?: boolean; land?: boolean }) {
  const lines = statLines(stats).slice(0, limit);
  const grid = (
    <ul className="grid gap-px overflow-hidden border border-line bg-line shadow-soft sm:grid-cols-2 lg:grid-cols-3">
      {lines.map((s, i) => {
        const t = TONE[s.tone];
        const delay = 120 + Math.min(i, 5) * 90;
        return (
          <li key={s.key} className={`bg-panel p-4 ${reveal ? "reveal" : ""}`} style={reveal ? { ["--d0" as string]: "60ms", ["--i" as string]: i } : undefined}>
            <p className={`text-[1.3rem] font-semibold leading-tight tracking-tight ${s.tone === "neutral" ? "text-ink" : t.text}`}>
              {land ? <CountUp text={s.big} delay={delay} /> : s.big}
            </p>
            <p className="mt-0.5 font-sans text-[0.85rem] leading-snug text-muted">{s.label}</p>
            {s.meter != null && (
              <div className="meter mt-2" aria-hidden="true">
                <span className={t.bg} style={{ width: `${Math.max(2, Math.round(s.meter * 100))}%`, ...(land ? { ["--d" as string]: `${delay}ms` } : {}) }} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return land ? <CountUpGroup>{grid}</CountUpGroup> : grid;
}
