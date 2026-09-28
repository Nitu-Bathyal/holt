import Link from "next/link";
import { compact } from "@/lib/discover";
import type { Recommendation } from "@/lib/types";
import { StarterIssueCard } from "../report/starter-issues";
import { TONE } from "../report/tone";
import { VerdictPill } from "../report/verdict-pill";

/** One pick: the repo, why it was picked (server rules), and issues to start with. */
export function PickCard({ p, rank }: { p: Recommendation; rank: number }) {
  const [owner, name] = p.repo.split("/");
  return (
    <li className="border border-line-strong bg-panel p-5 shadow-soft sm:p-6">
      <div className="grid grid-cols-[2.25rem_1fr] gap-x-3 sm:grid-cols-[3rem_1fr]">
        <span className="text-[1.5rem] font-semibold leading-none tabular-nums text-faint sm:text-[1.9rem]">{rank}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <h2 className="text-[1.08rem] font-semibold tracking-tight [overflow-wrap:anywhere]">
              <Link href={`/${p.repo}`} className="hover:text-blue">
                <span className="text-muted">{owner}/</span>
                {name}
              </Link>
            </h2>
            <VerdictPill headline={p.headline} tone={p.tone} />
          </div>
          {p.description && <p className="mt-1 line-clamp-2 font-sans text-[0.9rem] text-muted">{p.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem] text-faint">
            {p.language && <span>{p.language}</span>}
            {p.stars != null && <span>★ {compact(p.stars)}<span className="sr-only"> stars</span></span>}
            {p.topics.slice(0, 4).map((t) => (
              <span key={t} className="border border-line px-1.5 py-0.5">{t}</span>
            ))}
          </div>

          <h3 className="mt-5 text-[0.72rem] uppercase tracking-[0.08em] text-faint">Why this one</h3>
          <ul className="mt-2 space-y-1 font-sans text-[0.9rem]">
            {p.why.map((w) => (
              <li key={w} className="flex gap-2">
                <span aria-hidden="true" className="text-green">✓</span>
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-3 font-sans text-[0.85rem] text-muted">{p.reason} {p.numbers_line}</p>
          {p.odds && (
            <p className="mt-1 font-sans text-[0.85rem] text-muted">
              Your odds: <span className={`font-semibold ${TONE[p.odds.tone].text}`}>{p.odds.level}</span>, {p.odds.text}.
            </p>
          )}

          {p.issues.length > 0 && (
            <>
              <h3 className="mt-5 text-[0.72rem] uppercase tracking-[0.08em] text-faint">Start with</h3>
              <ul className="mt-2 grid gap-3">
                {p.issues.map((i) => (
                  <StarterIssueCard key={i.number} issue={i} compact />
                ))}
              </ul>
            </>
          )}
          <Link href={`/${p.repo}`} className="mt-4 inline-block text-[0.8rem] text-green hover:underline">
            [ read the report{p.issues.length ? "" : " and its starter issues"} ]
          </Link>
        </div>
      </div>
    </li>
  );
}
