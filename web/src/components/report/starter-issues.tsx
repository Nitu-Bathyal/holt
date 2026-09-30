import { nextStep, timeAgo } from "@/lib/format";
import type { StarterIssue } from "@/lib/types";
import { Skeleton, SkeletonRegion } from "../skeleton";

export function StarterIssueCard({ issue, compact = false }: { issue: StarterIssue; compact?: boolean }) {
  return (
    <li className="card-hover group relative border border-line bg-panel p-4 shadow-soft sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-[0.8rem] text-faint">
        <span className="text-blue">#{issue.number}</span>
        {issue.labels.slice(0, 3).map((l) => (
          <span key={l} className="chip min-h-0 py-0.5">{l}</span>
        ))}
        <span className="ml-auto">
          {issue.comments} comment{issue.comments === 1 ? "" : "s"}
          {issue.created_at && <> · {timeAgo(issue.created_at)}</>}
        </span>
      </div>
      <h3 className="mt-2 font-sans text-[1rem] font-semibold leading-snug text-ink">
        <a href={issue.url} target="_blank" rel="noopener noreferrer" data-umami-event="starter-issue-click" className="after:absolute after:inset-0 group-hover:text-blue">
          {issue.title}
          <span className="sr-only"> (opens GitHub)</span>
        </a>
      </h3>
      {issue.on_it && (
        <p className={`mt-1 font-sans text-[0.88rem] ${issue.people || issue.open_prs ? "text-amber" : "text-green"}`}>{issue.on_it}</p>
      )}
      {!compact && issue.why.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-sans text-[0.89rem] text-muted">
          {issue.why.map((w) => (
            <li key={w} className="flex gap-2">
              <span aria-hidden="true" className="text-faint">·</span>
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex gap-2 border-t border-dashed border-line pt-3 font-sans text-[0.9rem] text-green">
        <span aria-hidden="true">→</span>
        <span>
          <span className="sr-only">What to do next: </span>
          {nextStep(issue)}
        </span>
      </p>
    </li>
  );
}

/**
 * One issue as a thin row for the report: number, title, its labels, whether
 * anyone is on it, and its age, on one line from `sm` up (two on a phone). The
 * whole row is the link; the next step is in its tooltip and read out after it.
 */
export function StarterIssueRow({ issue }: { issue: StarterIssue }) {
  const taken = Boolean(issue.people || issue.open_prs);
  const step = nextStep(issue);
  return (
    <li className="group relative flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 hover:bg-panel-2/50 sm:flex-nowrap" title={step}>
      <span className="shrink-0 font-mono text-[0.82rem] text-blue">#{issue.number}</span>
      <a href={issue.url} target="_blank" rel="noopener noreferrer" data-umami-event="starter-issue-click" className="min-w-0 flex-1 basis-full truncate font-sans text-[0.93rem] font-medium text-ink after:absolute after:inset-0 group-hover:text-blue sm:basis-auto">
        {issue.title}
        <span className="sr-only"> (opens GitHub). {step}</span>
      </a>
      {issue.labels.length > 0 && (
        <span className="hidden shrink-0 gap-1.5 text-[0.74rem] text-faint md:flex">
          {issue.labels.slice(0, 2).map((l) => (
            <span key={l} className="max-w-[9rem] truncate">{l}</span>
          ))}
        </span>
      )}
      <span className={`shrink-0 font-sans text-[0.8rem] ${taken ? "text-amber" : "text-green"}`}>{issue.on_it ?? (taken ? "Someone is on it" : "Nobody on it yet")}</span>
      <span className="shrink-0 font-sans text-[0.78rem] text-faint">
        {issue.comments} comment{issue.comments === 1 ? "" : "s"}
        {issue.created_at && <> · {timeAgo(issue.created_at)}</>}
      </span>
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
    <ul className="divide-y divide-line border-y border-line">
      {issues.map((i) => (
        <StarterIssueRow key={i.number} issue={i} />
      ))}
    </ul>
  );
}

/** Three thin rows, where the issues will stream in. */
export function StarterIssuesSkeleton() {
  return (
    <SkeletonRegion as="ul" label="Loading starter issues…" className="divide-y divide-line border-y border-line">
      {[0, 1, 2].map((i) => (
        <li key={i} className="py-1.5">
          <Skeleton className="h-5 w-full" />
        </li>
      ))}
    </SkeletonRegion>
  );
}
