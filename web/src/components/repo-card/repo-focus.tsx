import Link from "next/link";
import { compact } from "@/lib/discover";
import { langColor, statPills, type CardRepo } from "@/lib/repo-card";
import { StarterIssueCard } from "../report/starter-issues";
import { TONE } from "../report/tone";
import { VerdictPill } from "../report/verdict-pill";
import { OddsBar, OddsLegend } from "./odds-bar";
import { LangDot, RepoAvatar } from "./repo-avatar";

/** Everything a list knows about one repo: the full numbers, why it's here, and issues to start with. */
export function RepoFocus({ r, report, actions, topicBase }: { r: CardRepo; report: string; actions?: React.ReactNode; topicBase?: string }) {
  const [owner, name] = r.repo.split("/");
  return (
    <div>
      <div className="flex items-start gap-4">
        <RepoAvatar repo={r.repo} size={48} />
        <div className="min-w-0 flex-1">
          <h2 id="focus-title" className="text-[1.375rem] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[1.375rem]">
            <Link href={report} className="hover:text-blue">
              <span className="text-muted">{owner}/</span>
              {name}
            </Link>
          </h2>
          {r.description && <p className="mt-1.5 font-sans text-[1rem] text-muted">{r.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] text-faint">
            <VerdictPill headline={r.headline} tone={r.tone} />
            {r.language && (
              <span className="flex items-center gap-1.5">
                <LangDot color={langColor(r.language)} />
                {r.language}
              </span>
            )}
            {r.stars != null && <span>★ {compact(r.stars)}<span className="sr-only"> stars</span></span>}
            {r.checkedThisWeek != null && <span className="text-blue">checked by {r.checkedThisWeek} people this week</span>}
            {r.topics.slice(0, 5).map((t) =>
              topicBase ? (
                <Link key={t} href={`${topicBase}${topicBase.includes("?") ? "&" : "?"}topic=${encodeURIComponent(t)}`} className="border border-line px-1.5 py-0.5 hover:border-blue hover:text-ink">
                  {t}
                </Link>
              ) : (
                <span key={t} className="border border-line px-1.5 py-0.5">{t}</span>
              ),
            )}
          </div>
        </div>
      </div>

      <section aria-label="What happens to outside pull requests" className="mt-6">
        <OddsBar stats={r.stats} className="h-3" />
        <OddsLegend stats={r.stats} />
        <ul className="mt-4 flex flex-wrap gap-2 text-[0.8125rem]">
          {statPills(r.stats).map((p, i) => (
            <li key={p} className={`border px-2 py-1 ${i === 0 ? "border-green/40 text-green" : "border-line-strong text-muted"}`}>{p}</li>
          ))}
        </ul>
        {(r.reason || r.numbersLine) && <p className="mt-4 font-sans text-[0.875rem] leading-relaxed text-muted">{r.reason} {r.numbersLine}</p>}
        {r.odds && (
          <p className="mt-2 font-sans text-[0.875rem] text-muted">
            Your odds: <span className={`font-semibold ${TONE[r.odds.tone].text}`}>{r.odds.level}</span>, {r.odds.text}.
          </p>
        )}
      </section>

      {r.why.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[0.875rem] text-faint">Why this one</h3>
          <ul className="mt-2 space-y-1 font-sans text-[0.875rem]">
            {r.why.map((w) => (
              <li key={w} className="flex gap-2">
                <span aria-hidden="true" className="text-green">✓</span>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.issues.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[0.875rem] text-faint">Start with one of these</h3>
          <ul className="mt-2 grid gap-3">
            {r.issues.slice(0, 4).map((i) => (
              <StarterIssueCard key={i.number} issue={i} />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={report} className="btn-primary">{r.issues.length ? "read the full report" : "see its starter issues"}</Link>
        {actions}
      </div>
    </div>
  );
}
