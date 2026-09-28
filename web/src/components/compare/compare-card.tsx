import Link from "next/link";
import { humanHours, pct } from "@/lib/format";
import type { Lead } from "@/lib/compare";
import { fullStats } from "@/lib/repo-card";
import type { Report } from "@/lib/types";
import { CatFace } from "../cat-face";
import { OddsBar } from "../repo-card/odds-bar";
import { RepoAvatar } from "../repo-card/repo-avatar";
import { TONE, TONE_MOOD } from "../report/tone";

export function CompareShell({ repo, removeHref, children }: { repo: string; removeHref: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col border border-line-strong bg-panel shadow-soft">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <RepoAvatar repo={repo} size={28} />
        <Link href={`/${repo}`} className="flex min-h-11 min-w-0 flex-1 items-center text-[0.875rem] font-semibold hover:text-blue" title={repo}>
          {/* The ellipsis needs a block child: text-overflow doesn't apply to a flex container's text. */}
          <span className="truncate">{repo}</span>
        </Link>
        <Link href={removeHref} className="grid size-11 place-items-center text-faint hover:text-orange" aria-label={`Remove ${repo} from comparison`}>✕</Link>
      </div>
      <div className="flex-1">{children}</div>
    </li>
  );
}

/** One column's numbers. `leads` marks the ones where this repo does best of those compared. */
export function CompareBody({ report, leads = [] }: { report: Report; leads?: Lead[] }) {
  const s = report.stats;
  const t = TONE[report.tone];
  const top = report.landing[0];
  const rows: [string, React.ReactNode, Lead | null][] = [
    ["Outside PRs merged", <><strong className="text-ink">{s.outsider_merged}</strong> of {s.outsider_attempts} ({pct(s.outsider_merged, s.outsider_attempts)}%)</>, "merged"],
    ["Typical first reply", s.median_first_response_hours == null ? <span className="text-orange">no replies</span> : humanHours(s.median_first_response_hours), "reply"],
    ["First-timers merged", <strong key="f" className={s.first_time_merged_authors ? "text-green" : "text-orange"}>{s.first_time_merged_authors}</strong>, "firstTimers"],
    ["Never got a reply", `${pct(s.no_reply, s.outsider_attempts)}%`, "silent"],
    ["Best way in", top ? <code key="c" className="text-ink">{top.path}/</code> : <span className="text-faint">none yet</span>, null],
  ];
  return (
    <>
      <div className={`p-4 ${t.soft}`}>
        <CatFace mood={TONE_MOOD[report.tone]} className="text-[1.125rem]" />
        <p className={`mt-2 text-[1.375rem] font-semibold leading-tight tracking-tight ${t.text}`}>{report.headline}</p>
        <OddsBar stats={fullStats(s)} className="mt-4 h-2" />
      </div>
      <dl className="divide-y divide-line">
        {rows.map(([k, v, lead]) => {
          const best = lead != null && leads.includes(lead);
          return (
            <div key={k} className={`grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-[0.875rem] ${best ? "bg-green/[0.06]" : ""}`}>
              <dt className="font-sans text-muted">{k}</dt>
              <dd className="text-right text-muted">
                {v}
                {best && <span className="ml-1.5 text-green" title="Best of these">▲<span className="sr-only"> (best of these)</span></span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </>
  );
}
