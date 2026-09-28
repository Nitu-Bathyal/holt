// A themed row on the signed-in home: a title and repos that scroll sideways.
// Repos use the compact repo card (RepoRows in repo-card/repo-grid.tsx) and a
// repo's pull requests stack into one card (pull-stack.tsx). A tile is for a
// repo Holt has no card for: an older check, or a saved repo with no report.
import Link from "next/link";
import type { Tone } from "@/lib/types";
import { VerdictPill } from "../report/verdict-pill";

export interface Tile {
  /** Unique within its row. */
  key: string;
  repo: string;
  href: string;
  verdict: { headline: string; tone: Tone } | null;
  line: string | null;
  meta?: string | null;
}

export function Shelf({ title, more, note, children }: { title: string; more?: { href: string; label: string }; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[1.08rem] font-semibold tracking-tight">{title}</h2>
        <span className="flex items-baseline gap-4 text-[0.78rem]">
          {note && <span className="hidden text-faint sm:inline">{note}</span>}
          {more && <Link href={more.href} className="inline-flex min-h-11 items-center text-blue hover:underline sm:min-h-0">{more.label}</Link>}
        </span>
      </div>
      <ul className="-mx-4 mt-2 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {children}
      </ul>
    </section>
  );
}

export function RepoTile({ t, actions }: { t: Tile; actions?: React.ReactNode }) {
  const [owner, name] = t.repo.split("/");
  return (
    <li className="flex w-[17.5rem] shrink-0 snap-start flex-col border border-line-strong bg-panel p-4 shadow-soft sm:w-[19rem]">
      <Link href={t.href} className="font-semibold tracking-tight [overflow-wrap:anywhere] hover:text-blue">
        <span className="text-muted">{owner}/</span>
        {name}
      </Link>
      {t.verdict && <VerdictPill headline={t.verdict.headline} tone={t.verdict.tone} className="mt-2 self-start" />}
      {t.line && <p className="mt-2 line-clamp-3 font-sans text-[0.85rem] leading-snug text-muted">{t.line}</p>}
      {(t.meta || actions) && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3">
          {t.meta && <p className="text-[0.72rem] text-faint">{t.meta}</p>}
          {actions && <span className="ml-auto">{actions}</span>}
        </div>
      )}
    </li>
  );
}
