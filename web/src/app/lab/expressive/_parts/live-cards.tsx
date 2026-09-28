"use client";

// PROTOTYPE, pattern 5: cards that answer the pointer. The odds bar fills
// segment by segment, in the legend's order (merged first), as the card comes
// into view. Hover or focus the card and the bar thickens while the short
// numbers swap for the full count under each colour: the detail is there on
// demand, in the same space, so nothing below moves. A soft light follows the
// pointer (a transformed layer, no repaint of the card).
import Link from "next/link";
import { compact } from "@/lib/discover";
import { oddsSegments, oddsText, statPills, type CardRepo } from "@/lib/repo-card";
import { TONE_MOOD } from "@/components/report/tone";
import { SEGMENT_CLASS } from "@/components/repo-card/odds-bar";
import { VerdictPill } from "@/components/report/verdict-pill";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { LabCat } from "./lab-cat";
import { useReduced, useSeen } from "./motion";
import { useState } from "react";

export function LiveCards({ cards }: { cards: CardRepo[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((r, i) => (
        <LiveCard key={r.repo} r={r} i={i} />
      ))}
    </div>
  );
}

function LiveCard({ r, i }: { r: CardRepo; i: number }) {
  const reduced = useReduced();
  const { ref, seen, below } = useSeen<HTMLElement>();
  const [hot, setHot] = useState(false);
  const [owner, name] = r.repo.split("/");
  const segs = oddsSegments(r.stats);
  const decided = segs?.reduce((a, s) => a + (s.key === "recent" ? 0 : s.n), 0) ?? 0;
  const width = (s: { key: string; n: number }) => (s.key === "recent" ? Math.min(s.n, decided / 2) : s.n);
  const total = segs?.reduce((a, s) => a + width(s), 0) ?? 1;
  const phase = reduced || !below ? "done" : seen ? "go" : "wait";

  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const b = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - b.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - b.top}px`);
  };

  return (
    <article
      ref={ref}
      data-phase={phase}
      data-hot={hot}
      onPointerMove={move}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHot(false)}
      className={`xp-card xp-card--${r.tone} relative flex h-full flex-col overflow-hidden border border-line-strong bg-panel p-4 shadow-soft`}
      style={{ ["--ci" as string]: i }}
    >
      <span aria-hidden="true" className="xp-card-light" />
      <div className="relative flex items-start gap-3">
        <RepoAvatar repo={r.repo} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1rem] font-semibold leading-tight tracking-tight">
            <Link href={`/${r.repo}`} className="hover:text-blue">
              <span className="text-muted">{owner}/</span>
              {name}
            </Link>
          </h3>
          {r.description && <p className="mt-0.5 truncate font-sans text-[0.88rem] text-muted">{r.description}</p>}
        </div>
        <LabCat mood={hot ? TONE_MOOD[r.tone] : "ready"} blink={false} className="shrink-0 text-[0.85rem] opacity-80" />
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-3">
        <VerdictPill headline={r.headline} tone={r.tone} className="shrink-0 px-1.5 py-0.5 text-[0.76rem]" />
        {r.stars != null && <span className="text-[0.8rem] text-faint">★ {compact(r.stars)}<span className="sr-only"> stars</span></span>}
      </div>

      <div role="img" aria-label={oddsText(r.stats)} className="xp-odds relative mt-3 flex gap-px bg-panel-2">
        {segs?.map((s, k) => (
          <span
            key={s.key}
            className={`xp-seg ${SEGMENT_CLASS[s.key]}`}
            style={{ flexGrow: width(s), flexBasis: 0, minWidth: width(s) / total < 0.02 ? 3 : 0, ["--k" as string]: k }}
          />
        ))}
      </div>

      {/* The pills and the full legend share one grid cell: they crossfade. */}
      <div className="relative mt-2.5 grid text-[0.78rem]">
        <ul className="xp-rest col-start-1 row-start-1 flex flex-wrap content-start gap-1.5">
          {statPills(r.stats).map((p, k) => (
            <li key={p} className={`border px-1.5 py-0.5 ${k === 0 ? "border-green/40 text-green" : "border-line text-muted"}`}>{p}</li>
          ))}
        </ul>
        <ul aria-hidden="true" className="xp-legend col-start-1 row-start-1 flex flex-wrap content-start gap-x-3 gap-y-1 py-0.5 text-muted">
          {segs?.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`inline-block size-2 ${SEGMENT_CLASS[s.key]}`} />
              <span className="font-semibold tabular-nums text-ink">{s.n}</span> {s.key === "replied" ? "replied" : s.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mt-auto flex items-center gap-4 pt-4 text-[0.85rem]">
        <Link href={`/${r.repo}`} className="text-green hover:underline">
          [ full report → ]
        </Link>
      </div>
    </article>
  );
}
