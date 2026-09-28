"use client";

// The numbered first-PR plan. Each step can be ticked off; ticks are a
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
  return (
    <div>
      {show === steps.length && (
        <p className="mb-3 text-[0.82rem] text-faint" aria-live="polite">
          {count === 0 ? `${steps.length} steps · tick them off as you go` : count === steps.length ? "all done. open your pull request." : `${count} of ${steps.length} done`}
        </p>
      )}
      <ol className="border-t border-line">
        {steps.slice(0, show).map((s, i) => (
          <li key={i} className="border-b border-line py-6">
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4">
              <label className="relative mt-0.5 grid size-9 cursor-pointer place-items-center border border-line-strong bg-panel text-[0.9rem] font-semibold tabular-nums transition-colors has-[:checked]:border-green has-[:checked]:bg-green has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue">
                <input type="checkbox" className="sr-only" checked={done[i]} onChange={() => toggle(i)} aria-label={`Step ${i + 1} done`} />
                <span aria-hidden="true">{done[i] ? "✓" : i + 1}</span>
              </label>
              <div className="min-w-0">
                <p className={`font-sans text-[1.08rem] font-semibold leading-snug transition-colors sm:text-[1.15rem] ${done[i] ? "text-muted line-through decoration-line-strong" : "text-ink"}`}>
                  <PlanText text={s.title} />
                </p>
                {s.detail && (
                  <p className="mt-1.5 max-w-[62ch] font-sans text-[1rem] leading-relaxed text-muted">
                    <PlanText text={s.detail} />
                  </p>
                )}
                {s.copy && (
                  <div className="mt-3 border border-line-strong bg-bg">
                    <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                      <span className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">{s.copy.label}</span>
                      <CopyButton text={s.copy.text} className="min-h-9 px-2 text-[0.85rem] text-blue hover:text-ink" />
                    </div>
                    <p className="px-3 py-3 font-sans text-[0.95rem] leading-relaxed text-ink">{s.copy.text}</p>
                  </div>
                )}
                {s.link && (
                  <a href={s.link.url} target="_blank" rel="noopener noreferrer" className="text-link mt-2 inline-flex min-h-9 items-center font-sans text-[0.92rem]">
                    {s.link.label} ↗
                  </a>
                )}
                <Sources sources={s.sources} className="mt-2" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
