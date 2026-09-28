"use client";

// PROTOTYPE, pattern 4: the answer arrives. For a report that just finished
// (never a cached one: return visitors don't wait), the verdict's colour bar
// draws down, the headline stamps in on desktop (on phones it never moves: it
// is the page's largest paint), the cat reacts, and the numbers count up to
// their values while their meters fill. The server HTML is the final state.
import { useEffect, useState } from "react";
import type { CatMood } from "@/lib/cat";
import { LabCat } from "./lab-cat";
import { useReduced, useSeen } from "./motion";

export interface StampStat {
  /** e.g. "{n} of {n}"; each {n} counts up. */
  big: string;
  values: number[];
  decimals?: number;
  label: string;
  tone: "good" | "bad" | "warn" | "neutral";
  meter?: number;
}

const TEXT = { good: "text-green", bad: "text-orange", warn: "text-amber", neutral: "text-ink" } as const;
const BG = { good: "bg-green", bad: "bg-orange", warn: "bg-amber", neutral: "bg-blue" } as const;

export function VerdictStamp({
  repo,
  headline,
  line,
  tone,
  mood,
  stats,
}: {
  repo: string;
  headline: string;
  line: string;
  tone: "good" | "bad" | "warn";
  mood: CatMood;
  stats: StampStat[];
}) {
  const reduced = useReduced();
  const { ref, seen, below } = useSeen<HTMLDivElement>();
  const [run, setRun] = useState(0);
  const armed = !reduced && (below || run > 0);
  // "wait" = wound back, "go" = playing or done.
  const phase = !armed ? "done" : seen ? "go" : "wait";

  return (
    <div>
      <div ref={ref} className="xp-verdict relative overflow-hidden border border-line-strong bg-panel shadow-card" data-phase={phase} key={run}>
        <span aria-hidden="true" className={`xp-verdict-bar absolute inset-y-0 left-0 w-1 ${BG[tone]}`} />
        <div className="p-5 pl-6 sm:p-8 sm:pl-10">
          <div className="flex items-center justify-between gap-4 text-[0.8rem] text-faint">
            <span>verdict · {repo}</span>
            <LabCat mood={phase === "wait" ? "thinking" : mood} className="text-[1.1rem] sm:text-[1.5rem]" />
          </div>
          <h3 className={`display xp-verdict-headline mt-4 text-[2.4rem] sm:text-[3.6rem] ${TEXT[tone]}`}>
            {headline}
            <span className="text-ink">.</span>
          </h3>
          <p className="xp-verdict-line mt-3 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink">{line}</p>
          <ul className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-3">
            {stats.map((s, i) => (
              <li key={s.label} className="bg-panel p-5">
                <p className={`text-[1.6rem] font-semibold leading-tight tracking-tight ${TEXT[s.tone]}`} aria-label={fill(s.big, s.values, s.decimals, 1)}>
                  <CountUp stat={s} go={phase !== "wait"} animate={phase === "go"} delay={260 + i * 90} />
                </p>
                <p className="mt-1 font-sans text-[0.9rem] leading-snug text-muted">{s.label}</p>
                {s.meter != null && (
                  <div className="xp-meter-track mt-3" aria-hidden="true">
                    <span
                      className={`xp-meter block h-full origin-left ${BG[s.tone]}`}
                      style={{ ["--w" as string]: Math.max(0.02, s.meter), ["--d" as string]: `${260 + i * 90}ms` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {!reduced && (
        <p className="mt-2 text-right">
          <button type="button" onClick={() => setRun((n) => n + 1)} className="min-h-11 px-2 text-[0.8rem] text-muted hover:text-ink">
            [ replay ]
          </button>
        </p>
      )}
    </div>
  );
}

function fill(big: string, values: number[], decimals = 0, p: number) {
  let i = 0;
  return big.replace(/\{n\}/g, () => (values[i++] * p).toFixed(decimals));
}

/** Counts from zero to the value over 700ms once `go`; fixed width, so nothing shifts. */
function CountUp({ stat, go, animate, delay }: { stat: StampStat; go: boolean; animate: boolean; delay: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!go || !animate) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / 700));
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [go, animate, delay]);
  const p = !go ? 0 : !animate ? 1 : t;
  const final = fill(stat.big, stat.values, stat.decimals, 1);
  return (
    <span aria-hidden="true" className="inline-block tabular-nums" style={{ minWidth: `${final.length}ch` }}>
      {fill(stat.big, stat.values, stat.decimals, p)}
    </span>
  );
}
