import Link from "next/link";
import { boardHref, compact } from "@/lib/discover";
import { humanHours, mergeTone } from "@/lib/format";
import type { DiscoverRepo, DiscoverSort } from "@/lib/types";
import { TONE } from "../report/tone";
import { VerdictPill } from "../report/verdict-pill";

/** How many of the outside pull requests were merged, as words and a bar. */
function MergeShare({ merged, attempts }: { merged: number; attempts: number }) {
  if (!attempts) return <p className="text-[0.78rem] text-faint">No outside pull requests recently</p>;
  const share = merged / attempts;
  const t = TONE[mergeTone(Math.round(share * 100))];
  return (
    <div>
      <p className="text-[0.78rem]">
        <span className={`font-semibold ${t.text}`}>{merged} of {attempts}</span>{" "}
        <span className="text-muted">outside pull requests merged</span>
      </p>
      <div aria-hidden="true" className="mt-1.5 h-1.5 w-full max-w-56 bg-panel-2">
        <div className={`h-full ${t.bg}`} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </div>
    </div>
  );
}

function Row({ r, rank, sort }: { r: DiscoverRepo; rank: number; sort: DiscoverSort }) {
  const [owner, name] = r.repo.split("/");
  const reply = r.stats.median_first_response_hours;
  return (
    <li className="grid grid-cols-[2.25rem_1fr] gap-x-3 gap-y-4 p-5 sm:grid-cols-[3rem_1fr] sm:p-6 lg:grid-cols-[3rem_minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-x-8">
      <span className="text-[1.5rem] font-semibold leading-none tabular-nums text-faint sm:text-[1.9rem]">{rank}</span>
      <div className="min-w-0">
        <h2 className="text-[1.08rem] font-semibold tracking-tight [overflow-wrap:anywhere]">
          <Link href={`/${r.repo}`} className="hover:text-blue">
            <span className="text-muted">{owner}/</span>
            {name}
          </Link>
        </h2>
        {r.description && <p className="mt-1 line-clamp-2 font-sans text-[0.9rem] text-muted">{r.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem] text-faint">
          {r.language && <span>{r.language}</span>}
          {r.stars != null && <span>★ {compact(r.stars)}<span className="sr-only"> stars</span></span>}
          {r.checked_this_week != null && <span className="text-blue">checked by {r.checked_this_week} people this week</span>}
          {r.topics.slice(0, 4).map((t) => (
            <Link key={t} href={boardHref({ sort, language: r.language, topic: t })} className="border border-line px-1.5 py-0.5 hover:border-blue hover:text-ink">
              {t}
            </Link>
          ))}
        </div>
      </div>
      <div className="col-start-2 min-w-0 space-y-3 lg:col-start-3">
        <VerdictPill headline={r.headline} tone={r.tone} />
        <p className="font-sans text-[0.88rem] leading-snug">{r.reason}</p>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <MergeShare merged={r.stats.outsider_merged} attempts={r.stats.outsider_attempts} />
          <p className="text-[0.78rem] text-muted">
            {reply == null ? "No replies to measure" : <>First reply in <span className="font-semibold text-ink">{humanHours(reply)}</span></>}
          </p>
        </div>
        <Link href={`/${r.repo}`} className="inline-block text-[0.8rem] text-green hover:underline">
          [ read the report ]
        </Link>
      </div>
    </li>
  );
}

export function Board({ repos, sort }: { repos: DiscoverRepo[]; sort: DiscoverSort }) {
  return (
    <ol className="divide-y divide-line border border-line-strong bg-panel shadow-soft">
      {repos.map((r, i) => (
        <Row key={r.repo} r={r} rank={i + 1} sort={sort} />
      ))}
    </ol>
  );
}
