"use client";

import { ViewTransition } from "react";
import { personalise, type Fit } from "@/lib/profile";
import { AnalysisProgress } from "../analysis-progress";
import { ErrorPanel } from "../error-panel";
import { FindResults } from "./find-results";
import { useFindJob } from "./use-find-job";

/** Follows a queued /v1/find job (API.md allows 202 for slow searches). */
export function FindRunner({ jobId, days, retryHref = "/find", fit = null, saved, empty }: { jobId: string; days: number; retryHref?: string; fit?: Fit | null; saved?: string[] | null; empty?: React.ReactNode }) {
  const { stage, results, error } = useFindJob(jobId);

  if (error) return <ErrorPanel error={error} retryHref={retryHref} />;
  if (results)
    return (
      <ViewTransition enter="sk-in" default="none">
        <div>
          <FindResults results={personalise(results, fit)} days={days} saved={saved} empty={empty} />
        </div>
      </ViewTransition>
    );
  return (
    <ViewTransition exit="sk-out" default="none">
      <div>
        <AnalysisProgress repo="" kicker="searching · welcoming projects" note="Holt is checking which projects reply to outside contributors and have issues you could take. This can take a minute." mode="rules" stage={stage.stage} progress={stage.progress} />
      </div>
    </ViewTransition>
  );
}
