import { nextStep, timeAgo } from "@/lib/format";
import type { StarterIssue } from "@/lib/types";
import { SkeletonCard, SkeletonRegion } from "../skeleton";

export function StarterIssueCard({ issue, compact = false }: { issue: StarterIssue; compact?: boolean }) {
  return (
    <li className="card-hover group relative rounded-2xl border border-line bg-panel p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-[0.85rem] text-faint">
        <span className="font-medium text-blue">#{issue.number}</span>
        {issue.labels.slice(0, 3).map((l) => (
          <span key={l} className="rounded-full bg-panel-2 px-2.5 py-0.5 text-[0.8rem] text-muted">{l}</span>
        ))}
        <span className="ml-auto">
          {issue.comments} comment{issue.comments === 1 ? "" : "s"}
          {issue.created_at && <> · {timeAgo(issue.created_at)}</>}
        </span>
      </div>
      <h3 className="mt-3 text-[1.08rem] font-semibold leading-snug text-ink">
        <a href={issue.url} target="_blank" rel="noopener noreferrer" data-umami-event="starter-issue-click" className="after:absolute after:inset-0 group-hover:text-blue">
          {issue.title}
          <span className="sr-only"> (opens GitHub)</span>
        </a>
      </h3>
      {!compact && issue.why.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-[0.95rem] text-muted">
          {issue.why.map((w) => (
            <li key={w} className="flex gap-2">
              <span aria-hidden="true" className="text-faint">·</span>
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 flex gap-2 rounded-xl bg-bg px-3.5 py-2.5 text-[0.95rem] text-ink">
        <span aria-hidden="true" className="text-green">→</span>
        <span>
          <span className="sr-only">What to do next: </span>
          {nextStep(issue)}
        </span>
      </p>
    </li>
  );
}

/** null = still loading; "unavailable" = the server couldn't list them. */
export type IssuesState = StarterIssue[] | null | "unavailable";

export function StarterIssues({ issues, repo }: { issues: IssuesState; repo: string }) {
  const ghLink = `https://github.com/${repo}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`;
  if (issues === "unavailable") {
    return (
      <p className="font-sans text-muted">
        Holt can&apos;t list starter issues for this repo right now.{" "}
        <a className="text-link" href={ghLink} target="_blank" rel="noopener noreferrer">
          See its good first issues on GitHub ↗
        </a>
      </p>
    );
  }
  if (issues === null) return <StarterIssuesSkeleton />;
  if (!issues.length) {
    return (
      <p className="font-sans text-muted">
        No open, unclaimed starter issues right now.{" "}
        <a className="text-link" href={ghLink} target="_blank" rel="noopener noreferrer">
          Check GitHub for new ones ↗
        </a>
      </p>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {issues.map((i) => (
        <StarterIssueCard key={i.number} issue={i} />
      ))}
    </ul>
  );
}

/** Two cards in the real grid, while the issues stream in. */
export function StarterIssuesSkeleton() {
  return (
    <SkeletonRegion as="ul" label="Loading starter issues…" className="grid gap-3 md:grid-cols-2">
      <SkeletonCard />
      <SkeletonCard className="hidden md:block" />
    </SkeletonRegion>
  );
}
