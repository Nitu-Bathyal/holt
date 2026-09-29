"use client";

import { useEffect, useState, ViewTransition } from "react";
import { reportHref } from "@/lib/budget";
import { checkNeedsSignIn } from "@/lib/gate";
import type { Mode, Report } from "@/lib/types";
import { AnalysisProgress } from "../analysis-progress";
import { ErrorPanel } from "../error-panel";
import { useAnalysis } from "../use-analysis";
import { PartialReport } from "./partial-report";
import { ReportBodySkeleton } from "./report-skeleton";
import { ReportTeaser } from "./report-teaser";
import { ReportView } from "./report-view";
import { StarterIssues, type IssuesState } from "./starter-issues";

/**
 * Runs a check and shows its progress, then the report. `fallback` is a report
 * made by an older version of Holt's rules: shown, with a note, only if the
 * fresh check fails. `ticket`: a signed-out check (lib/anon-check.ts), which
 * ends on the teaser.
 */
export function AnalysisRunner({ repo, mode, days, signedIn, fallback, ticket }: { repo: string; mode: Mode; days: number; signedIn: boolean; fallback?: Report; ticket?: string }) {
  const { state, retry } = useAnalysis(repo, mode, days, true, ticket);
  const [issues, setIssues] = useState<IssuesState>(null);
  const showFallback = state.phase === "error" && fallback !== undefined;

  useEffect(() => {
    if (ticket || (state.phase !== "done" && !showFallback) || issues) return;
    fetch(`/api/repos/${repo}/starter-issues`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIssues(d?.issues ?? "unavailable"))
      .catch(() => setIssues("unavailable"));
  }, [state.phase, showFallback, repo, issues, ticket]);

  if (ticket && state.phase === "done")
    return (
      <ViewTransition enter="sk-in" default="none">
        <PartialReport report={state.report} back={reportHref(state.report.repo, days)} land={state.fresh} />
      </ViewTransition>
    );
  if (ticket && state.phase === "error" && checkNeedsSignIn(state.error.code)) return <ReportTeaser repo={repo} report={null} back={reportHref(repo, days)} />;
  if (showFallback)
    return (
      <div>
        <p role="status" className="mb-6 border border-line-strong bg-panel-2 px-4 py-3 text-[0.89rem] text-muted">
          Holt&rsquo;s rules changed and the re-check didn&rsquo;t finish, so this is the earlier result.{" "}
          <button type="button" onClick={retry} className="underline hover:text-ink">
            Try again
          </button>
        </p>
        <ReportView report={fallback} issues={<StarterIssues issues={issues} repo={fallback.repo} />} signedIn={signedIn} />
      </div>
    );
  if (state.phase === "error") return <ErrorPanel error={state.error} repo={repo} onRetry={retry} />;
  if (state.phase === "done")
    return (
      <ViewTransition enter="sk-in" default="none">
        <ReportView report={state.report} issues={<StarterIssues issues={issues} repo={state.report.repo} />} signedIn={signedIn} reveal land={state.fresh} />
      </ViewTransition>
    );
  return (
    <ViewTransition exit="sk-out" default="none">
      <div>
        <AnalysisProgress repo={repo} mode={mode} stage={state.phase === "running" ? state.stage : undefined} progress={state.phase === "running" ? state.progress : 0.02} />
        {/* The report's shape, dimmed and still, so the page doesn't jump when it lands. */}
        <div aria-hidden="true" className="sk-still mt-10">
          <ReportBodySkeleton />
        </div>
      </div>
    </ViewTransition>
  );
}
