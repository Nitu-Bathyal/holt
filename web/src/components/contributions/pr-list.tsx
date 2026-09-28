// The pull requests on My Contributions: what happened to each, and Holt's
// verdict on its repo (or a link to check it).
import Link from "next/link";
import { VerdictPill } from "@/components/report/verdict-pill";
import { STATE_LABEL, type PullState } from "@/lib/contributions";
import { timeAgo } from "@/lib/format";
import type { ContributionPR } from "@/lib/types";

const STATE_STYLE: Record<PullState, string> = {
  merged: "border-green/60 text-green",
  open: "border-blue/60 text-blue",
  closed: "border-line-strong text-muted",
};

function when(pr: ContributionPR): string {
  if (pr.state === "merged" && pr.merged_at) return `merged ${timeAgo(pr.merged_at)}`;
  if (pr.state === "closed" && pr.closed_at) return `closed ${timeAgo(pr.closed_at)}`;
  return `opened ${timeAgo(pr.created_at)}`;
}

export function PrList({ prs }: { prs: ContributionPR[] }) {
  return (
    <ul className="border border-line-strong bg-panel shadow-soft">
      {prs.map((pr) => (
        <li key={`${pr.repo}#${pr.number}`} className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem]">
            <Link href={`/${pr.repo}`} className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere] hover:underline">
              {pr.repo}
            </Link>
            <span className={`border px-1.5 py-0.5 text-[0.8125rem] ${STATE_STYLE[pr.state]}`}>
              {pr.draft && pr.state === "open" ? "draft" : STATE_LABEL[pr.state]}
            </span>
            {pr.found_via_holt && (
              <span className="border border-blue bg-blue/10 px-1.5 py-0.5 text-[0.8125rem] font-semibold text-blue" title="You opened this within 30 days of checking the repo on Holt">
                found via Holt
              </span>
            )}
          </div>
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className="prose-sans mt-2 block text-[1rem] leading-snug [overflow-wrap:anywhere] hover:underline">
            {pr.title || `Pull request #${pr.number}`} <span className="text-faint">#{pr.number}</span>
            <span className="sr-only"> (opens GitHub)</span>
          </a>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <time dateTime={pr.merged_at ?? pr.closed_at ?? pr.created_at} className="text-[0.8125rem] text-faint">{when(pr)}</time>
            {pr.verdict ? (
              <Link href={`/${pr.repo}`} aria-label={`Holt's verdict on ${pr.repo}: ${pr.verdict.headline}`} className="hover:opacity-80">
                <VerdictPill headline={pr.verdict.headline} tone={pr.verdict.tone} />
              </Link>
            ) : (
              <Link href={`/${pr.repo}`} className="text-[0.8125rem] text-link">check this repo →</Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
