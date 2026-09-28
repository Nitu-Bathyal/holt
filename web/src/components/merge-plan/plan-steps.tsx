"use client";

// "Your first pull request" as a timeline: numbered nodes on one line, first
// step to last. Each node ticks off; a done node fills green and so does the
// line down to the next one, so the progress reads at a glance. Ticks are a
// per-visitor convenience kept in this browser only (localStorage), so the
// page renders the same without them.
import { useMemo, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/copy-button";
import type { PlanStep } from "@/lib/merge-plan";
import { PlanText, Sources } from "./plan-bits";

const key = (repo: string) => `holt:plan-steps:${repo}`;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(repo: string): string {
  try {
    return localStorage.getItem(key(repo)) ?? "[]";
  } catch {
    return "[]";
  }
}

export function PlanSteps({ repo, steps, show = steps.length }: { repo: string; steps: PlanStep[]; show?: number }) {
  const raw = useSyncExternalStore(subscribe, () => read(repo), () => "[]");
  const done = useMemo(() => {
    let saved: unknown = [];
    try {
      saved = JSON.parse(raw);
    } catch {}
    return steps.map((_, i) => Array.isArray(saved) && saved[i] === true);
  }, [raw, steps]);

  const toggle = (i: number) => {
    try {
      localStorage.setItem(key(repo), JSON.stringify(done.map((d, j) => (j === i ? !d : d))));
    } catch {}
    listeners.forEach((l) => l());
  };

  const count = done.filter(Boolean).length;
  const shown = steps.slice(0, show);
  return (
    <div>
      {show === steps.length && (
        <div className="mb-8 flex items-center gap-4">
          <div className="meter flex-1" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Steps done">
            <span className="bg-green transition-[width] duration-500" style={{ width: `${(count / steps.length) * 100}%`, animation: "none" }} />
          </div>
          <p className="shrink-0 text-[0.8rem] uppercase tracking-[0.08em] text-faint" aria-live="polite">
            {count === steps.length ? "ready to open your PR" : `${count} of ${steps.length} done`}
          </p>
        </div>
      )}
      <ol className="relative">
        {shown.map((s, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={i} className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-5 sm:gap-x-6">
              {/* The line down to the next step: green once this one is done. */}
              {!last && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[calc(1.25rem-1px)] top-10 bottom-0 w-0.5 transition-colors duration-300 ${done[i] ? "bg-green" : "bg-line-strong"}`}
                />
              )}
              <label
                className={`relative z-10 grid size-10 cursor-pointer place-items-center rounded-full border-2 text-[0.95rem] font-semibold tabular-nums transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
                  done[i] ? "border-green bg-green text-on-accent" : "border-line-strong bg-panel text-ink hover:border-green"
                }`}
              >
                <input type="checkbox" className="sr-only" checked={done[i]} onChange={() => toggle(i)} aria-label={`Step ${i + 1} done`} />
                <span aria-hidden="true">{done[i] ? "✓" : i + 1}</span>
              </label>
              <div className={`min-w-0 ${last ? "" : "pb-10"}`}>
                <p className="pt-2 text-[0.75rem] uppercase tracking-[0.08em] text-faint">step {i + 1}</p>
                <h3 className={`mt-1 text-[1.1rem] font-semibold leading-snug tracking-tight transition-colors sm:text-[1.2rem] ${done[i] ? "text-muted line-through decoration-line-strong" : "text-ink"}`}>
                  <PlanText text={s.title} />
                </h3>
                {s.detail && (
                  <p className="mt-2 max-w-[62ch] font-sans text-[1rem] leading-relaxed text-muted">
                    <PlanText text={s.detail} />
                  </p>
                )}
                {s.copy && (
                  <div className="mt-4 max-w-[680px] border border-line-strong bg-bg">
                    <div className="flex items-center justify-between border-b border-line-strong pl-4">
                      <span className="text-[0.75rem] uppercase tracking-[0.08em] text-faint">{s.copy.label}</span>
                      <CopyButton text={s.copy.text} className="self-stretch border-l border-line-strong px-4 py-2 text-[0.85rem] text-muted transition-colors hover:bg-green hover:text-on-accent" />
                    </div>
                    <p className="px-4 py-3 font-sans text-[0.98rem] leading-relaxed text-ink">{s.copy.text}</p>
                  </div>
                )}
                {s.link && (
                  <a href={s.link.url} target="_blank" rel="noopener noreferrer" className="text-link mt-3 inline-flex min-h-9 items-center text-[0.88rem]">
                    {s.link.label} ↗
                  </a>
                )}
                <Sources sources={s.sources} className="mt-2" />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
