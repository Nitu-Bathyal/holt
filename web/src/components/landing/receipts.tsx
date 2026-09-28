"use client";

// Landing section 05, "read the receipts" (docs/design/EXPRESSIVE.md pattern
// 6). Both threads say "closed" on GitHub; a highlighter in the verdict's
// colour runs under the words that decide it as you scroll past, the thread's
// bar draws and Holt's reading nudges in. Tied to scroll where the browser has
// view timelines, played once on entering elsewhere (globals.css, .ls-receipts).
// Point at a thread and it lifts: the highlight deepens and the reading slides
// over. Reduced motion: already highlighted, nothing moves.
import { useSeen } from "../motion/use-seen";

const THREADS = [
  { id: "PR / 4821", before: "Thanks for this! ", mark: "Merged.", after: " Could you also look at the sibling case?", verdict: "→ there's a way in", tone: "text-green", bar: "bg-green", ink: "good" },
  { id: "PR / 917", before: "We're rewriting this module internally, ", mark: "closing.", after: "", verdict: "→ don't spend the week", tone: "text-orange", bar: "bg-orange", ink: "bad" },
];

export function Receipts() {
  const { ref, seen } = useSeen<HTMLDivElement>("0px 0px -30% 0px");
  return (
    <div ref={ref} className="ls-receipts border-t border-line-strong" data-seen={seen}>
      {THREADS.map((t) => (
        <article key={t.id} className="ls-thread ls-lift relative grid grid-cols-1 gap-2 border-b border-line py-7 md:grid-cols-[130px_minmax(0,1fr)_220px] md:gap-6">
          <span aria-hidden="true" className={`ls-thread-bar absolute -left-3 inset-y-0 w-0.5 md:-left-5 ${t.bar}`} />
          <div className="flex items-center gap-2 text-[0.82rem] text-faint md:block">
            {t.id}
            <span className="mt-1 inline-block border border-line-strong px-1.5 text-[0.75rem] md:block md:w-max">closed</span>
          </div>
          <blockquote className="m-0 font-sans text-[clamp(1.06rem,min(1.6vw,2.8svh),1.6rem)] leading-snug text-ink">
            “{t.before}
            <mark className="ls-mark" data-ink={t.ink}>
              {t.mark}
            </mark>
            {t.after}”
          </blockquote>
          <div className={`ls-thread-verdict text-[0.95rem] font-semibold md:text-right ${t.tone}`}>{t.verdict}</div>
        </article>
      ))}
    </div>
  );
}
