"use client";

// PROTOTYPE, pattern 3: Holt shows its own work. A terminal replays a real
// recorded check (the example report's numbers, not made up): the command
// types itself, each step prints, the counts tick up, and the verdict lands.
// The cat thinks while it runs and reacts to the answer. Starts when scrolled
// into view; reduced motion prints the whole log at once.
import { useEffect, useState } from "react";
import type { CatMood } from "@/lib/cat";
import { LabCat } from "./lab-cat";
import { useReduced, useSeen } from "./motion";

export interface ReplayLine {
  text: string;
  /** Numbers in the line that count up as it prints. */
  counts?: number[];
  tone?: "good" | "bad" | "warn" | "faint";
}

const TONE = { good: "text-green", bad: "text-orange", warn: "text-amber", faint: "text-faint" } as const;
const TYPE_MS = 26;
const LINE_MS = 380;

export function TerminalReplay({ command, lines, verdict, tone, mood }: { command: string; lines: ReplayLine[]; verdict: string; tone: "good" | "bad" | "warn"; mood: CatMood }) {
  const reduced = useReduced();
  const { ref, seen, below } = useSeen<HTMLDivElement>();
  // The server HTML is the finished log. Below the fold, it's wound back
  // before it can be seen, then plays once it is. Seen at load: left as is.
  // step: how far the replay has got (the command's characters, then lines).
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const armed = !reduced && (below || run > 0);
  const typed = armed ? Math.min(step, command.length) : command.length;
  const shown = armed ? Math.max(0, step - command.length) : lines.length + 1;

  useEffect(() => {
    if (!armed || !seen) return;
    const timers: number[] = [];
    for (let i = 1; i <= command.length; i++) timers.push(window.setTimeout(() => setStep(i), 300 + i * TYPE_MS));
    const start = 300 + command.length * TYPE_MS + 350;
    for (let j = 1; j <= lines.length + 1; j++) {
      const at = start + (j - 1) * LINE_MS + (j === lines.length + 1 ? 280 : 0);
      timers.push(window.setTimeout(() => setStep(command.length + j), at));
    }
    return () => timers.forEach(clearTimeout);
  }, [armed, seen, run, command.length, lines.length]);

  const done = shown > lines.length;
  const running = typed === command.length && !done;
  const catMood: CatMood = done ? mood : running ? "thinking" : "ready";

  return (
    <div ref={ref} className="xp-term border border-line-strong bg-panel shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[0.8rem] text-faint">
        <span>~/where-to-contribute</span>
        <LabCat mood={catMood} look={running ? Math.sin(shown * 1.7) : 0} className="text-[1.05rem]" />
      </div>
      {/* The full log for screen readers, whatever the animation is showing. */}
      <p className="sr-only">
        {command}. {lines.map(plain).join(" ")} Verdict: {verdict}.
      </p>
      <div aria-hidden="true" className="min-h-[19.5rem] px-4 py-4 text-[0.84rem] leading-[1.9] sm:px-5 sm:text-[0.92rem]">
        <p>
          <span className="text-amber">$ </span>
          {command.slice(0, typed)}
          {!running && !done && <span className="xp-caret" />}
        </p>
        {lines.slice(0, shown).map((l, i) => (
          <p key={`${run}-${i}`} className={`xp-line ${l.tone ? TONE[l.tone] : "text-muted"}`}>
            <Counted text={l.text} counts={l.counts} animate={armed} />
          </p>
        ))}
        {running && <span className="xp-caret" />}
        {done && (
          <p key={`v-${run}`} className={`xp-stamp mt-3 inline-block border-2 px-3 py-0.5 text-[1.05rem] font-semibold sm:text-[1.2rem] ${TONE[tone]}`}>
            ● {verdict}.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-line px-4 py-2 text-[0.8rem] text-faint">
        <span>a real check, recorded. the numbers are the report&apos;s.</span>
        {!reduced && (
          <button type="button" className="min-h-11 px-2 text-muted hover:text-ink disabled:opacity-40" onClick={() => {
              setStep(0);
              setRun((n) => n + 1);
            }} disabled={!done}>
            [ replay ]
          </button>
        )}
      </div>
    </div>
  );
}

/** A line with its numbers filled in. */
function plain(l: ReplayLine) {
  let i = 0;
  return l.text.replace(/\{n\}/g, () => String(l.counts?.[i++] ?? ""));
}

/** A line whose numbers count up from zero over 500ms as it prints. */
function Counted({ text, counts, animate }: { text: string; counts?: number[]; animate: boolean }) {
  const [p, setP] = useState(animate && counts?.length ? 0 : 1);
  useEffect(() => {
    if (!animate || !counts?.length) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 500);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, counts]);
  if (!counts?.length) return <>{text}</>;
  let i = 0;
  // Each number keeps the width of its final value, so the line never shifts.
  return (
    <>
      {text.split(/(\{n\})/).map((part, k) => {
        if (part !== "{n}") return <span key={k}>{part}</span>;
        const n = counts[i++];
        return (
          <span key={k} className="inline-block text-right tabular-nums text-ink" style={{ minWidth: `${String(n).length}ch` }}>
            {Math.round(n * p)}
          </span>
        );
      })}
    </>
  );
}
