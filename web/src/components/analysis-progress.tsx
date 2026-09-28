import { friendlyStage, STAGE_ORDER } from "@/lib/stages";
import { CatFace } from "./cat-face";

export function AnalysisProgress({ repo, stage, progress, mode, kicker, note }: { repo: string; stage?: string; progress: number; mode: "rules" | "ai"; kicker?: string; note?: string }) {
  const f = friendlyStage(stage);
  const idx = Math.max(0, STAGE_ORDER.indexOf(f.title));
  const pct = Math.round(Math.min(1, Math.max(0.03, progress)) * 100);
  return (
    <div className="scan border border-line-strong bg-panel p-6 shadow-card sm:p-10" aria-live="polite" aria-busy="true">
      {/* Phones: the cat sits above the text so the headline gets the full width. */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="break-words text-[0.8rem] uppercase tracking-[0.08em] text-faint">{kicker ?? `${mode === "ai" ? "writing your AI report" : "checking"} · ${repo}`}</p>
          <h1 className="mt-3 text-[1.5rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">{f.title}…</h1>
          <p className="mt-2 max-w-lg font-sans text-muted">{f.detail}</p>
        </div>
        <CatFace mood="determined" blink className="shrink-0 text-[1.4rem] sm:text-[2.2rem]" />
      </div>

      <div className="mt-8 h-1.5 bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
        <div className="h-full bg-blue transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>

      <ol className="mt-6 grid gap-2 text-[0.88rem] sm:grid-cols-4">
        {STAGE_ORDER.map((s, i) => {
          const done = i < idx;
          const now = i === idx;
          return (
            <li key={s} className={`flex items-center gap-2 ${done ? "text-green" : now ? "text-ink" : "text-faint"}`}>
              <span aria-hidden="true" className="w-4 text-center">
                {done ? "✓" : now ? <span className="inline-block size-2 animate-pulse rounded-full bg-blue" /> : "·"}
              </span>
              {s}
              <span className="sr-only">{done ? " (done)" : now ? " (in progress)" : ""}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-8 border-t border-dashed border-line pt-4 font-sans text-[0.89rem] text-faint">
        {note ?? "The first check of a repo takes about a minute. After that it's instant for everyone for a day."}
      </p>
    </div>
  );
}
