"use client";

// PROTOTYPE, pattern 6: reading the receipts. Both threads say "closed" on
// GitHub. As you scroll, a highlighter runs under the words that decide it,
// then Holt's reading of each lands beside it. Tied to scroll position where
// the browser supports scroll-driven animations (no JS per frame); elsewhere
// it plays once on entering. Reduced motion: already highlighted.
import { useSeen } from "./motion";

const THREADS = [
  { id: "PR / 4821", before: "Thanks for this! ", mark: "Merged.", after: " Could you also look at the sibling case?", verdict: "→ there's a way in", tone: "text-green", bar: "bg-green", ink: "good" },
  { id: "PR / 917", before: "We're rewriting this module internally, ", mark: "closing.", after: "", verdict: "→ don't spend the week", tone: "text-orange", bar: "bg-orange", ink: "bad" },
];

export function EvidenceMarker() {
  const { ref, seen } = useSeen<HTMLDivElement>("0px 0px -30% 0px");
  return (
    <div ref={ref} className="xp-evidence border-t border-line-strong" data-seen={seen}>
      {THREADS.map((t) => (
        <article key={t.id} className="xp-thread relative grid grid-cols-1 gap-2 border-b border-line py-7 md:grid-cols-[110px_minmax(0,1fr)_200px] md:gap-6">
          <span aria-hidden="true" className={`xp-thread-bar absolute -left-3 inset-y-0 w-0.5 md:-left-5 ${t.bar}`} />
          <div className="flex items-center gap-2 text-[0.82rem] text-faint md:block">
            {t.id}
            <span className="mt-1 inline-block border border-line-strong px-1.5 text-[0.75rem] md:block md:w-max">closed</span>
          </div>
          <blockquote className="m-0 font-sans text-[1.06rem] text-ink">
            “{t.before}
            <mark className="xp-mark" data-ink={t.ink}>{t.mark}</mark>
            {t.after}”
          </blockquote>
          <div className={`xp-thread-verdict text-[0.87rem] md:text-right ${t.tone}`}>{t.verdict}</div>
        </article>
      ))}
    </div>
  );
}
