"use client";

import { ViewTransition } from "react";
import { personalise, type Fit } from "@/lib/profile";
import type { FindResult } from "@/lib/types";
import { AnalysisProgress } from "../analysis-progress";
import { ErrorPanel } from "../error-panel";
import { FindResults } from "./find-results";
import { useFindJob } from "./use-find-job";

/**
 * Follows a queued /v1/find job (API.md allows 202 for slow searches). `index`
 * is what the 202 already carried (repos Holt has checked): shown while the
 * search runs, and kept if it fails.
 */
export function FindRunner({ jobId, index = [], days, retryHref = "/find", fit = null, saved, empty }: { jobId: string; index?: FindResult[]; days: number; retryHref?: string; fit?: Fit | null; saved?: string[] | null; empty?: React.ReactNode }) {
  const { stage, results, error } = useFindJob(jobId);
  const early = personalise(index, fit);

  if (error && !early.length) return <ErrorPanel error={error} retryHref={retryHref} />;
  if (results || early.length)
    return (
      <ViewTransition enter="sk-in" default="none">
        <div>
          <FindResults results={results ? personalise(results, fit) : early} days={days} saved={saved} empty={empty} />
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
