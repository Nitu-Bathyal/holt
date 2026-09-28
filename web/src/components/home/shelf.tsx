// A themed row on the signed-in home: a title and repos that scroll sideways.
// RepoTile is a stand-in until the find page's compact repo card lands on main.
import Link from "next/link";
import type { Tone } from "@/lib/types";
import { VerdictPill } from "../report/verdict-pill";

export interface Tile {
  /** Unique within its row. */
  key: string;
  repo: string;
  href: string;
  /** Replaces "owner/name" as the title, e.g. "pallets/flask#5432". */
  title?: string;
  verdict: { headline: string; tone: Tone } | null;
  line: string | null;
  meta?: string | null;
}

export function Shelf({ title, more, note, children }: { title: string; more?: { href: string; label: string }; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[1.08rem] font-semibold tracking-tight">{title}</h2>
        <span className="flex items-baseline gap-4 text-[0.85rem]">
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

export function RepoTile({ t }: { t: Tile }) {
  const [owner, name] = t.repo.split("/");
  return (
    <li className="flex w-[16.5rem] shrink-0 snap-start flex-col border border-line-strong bg-panel p-4 shadow-soft sm:w-72">
      <Link href={t.href} className="font-semibold tracking-tight [overflow-wrap:anywhere] hover:text-blue">
        {t.title ?? (
          <>
            <span className="text-muted">{owner}/</span>
            {name}
          </>
        )}
      </Link>
      {t.verdict && <VerdictPill headline={t.verdict.headline} tone={t.verdict.tone} className="mt-2 self-start" />}
      {t.line && <p className="mt-2 line-clamp-3 font-sans text-[0.89rem] leading-snug text-muted">{t.line}</p>}
      {t.meta && <p className="mt-auto pt-3 text-[0.8rem] text-faint">{t.meta}</p>}
    </li>
  );
}
