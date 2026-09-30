// The merge plan: the AI report (paid, written by holt-pro's POST
// /v1/merge-plan and served by the server's GET /v1/merge-plan). Its shape is
// API.md's `MergePlan`, generated into api-schema.ts; this file re-exports it
// with the helpers the plan's components share, and the recorded example.
import data from "./example-merge-plan.json" with { type: "json" };
import type { MergePlan, PlanAi, PlanClosing, PlanFact, PlanStep, PlaybookSource } from "./api-schema.ts";

export type { MergePlan, PlanAi, PlanClosing, PlanFact, PlanStep };
export type PlanSource = PlaybookSource;

/** Every GitHub link a plan cites, deduplicated: "checked against N pull requests". */
export function citedLinks(plan: MergePlan): string[] {
  const all = [
    ...plan.call.sources,
    ...plan.steps.flatMap((s) => s.sources),
    ...plan.merged.flatMap((f) => f.sources),
    ...plan.reviewers.sources,
  ].flatMap((s) => s.links);
  const closed = plan.closed.flatMap((c) => c.examples.map((e) => e.url));
  return [...new Set([...all, ...closed])];
}

/** "8 of 25" as a 0–100 share for meters; 0 when there is nothing to count. */
export function share(seen: number | null, of: number | null): number {
  if (seen == null || !of) return 0;
  return Math.round((Math.min(seen, of) / of) * 100);
}

/** The recorded example at /example-ai-report (processing/p5.js). */
export const EXAMPLE_PLAN = data as MergePlan;

/** "30 September 2026": when the example's evidence was recorded. */
export function planRecordedOn(plan: MergePlan = EXAMPLE_PLAN): string {
  return new Date(plan.recorded_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
