// The merge plan: the AI report (paid, written by holt-pro's POST
// /v1/merge-plan). This file is the one source of the MergePlan shape;
// the merge plan design notes describe it for holt-pro. Until the endpoint
// lands, only /example-ai-report renders one, from the example below.
import data from "./example-merge-plan.json" with { type: "json" };
import type { PlaybookSource, Tone, Verdict } from "./types.ts";

export type PlanSource = PlaybookSource;

export type PlanStep = {
  title: string; // may contain Markdown code spans
  detail: string | null;
  link: { label: string; url: string } | null;
  copy: { label: string; text: string } | null;
  sources: PlanSource[];
};

export type PlanFact = {
  value: string;
  unit: string;
  label: string; // may contain Markdown code spans
  seen: number | null;
  of: number | null;
  sources: PlanSource[];
};

export type PlanClosing = {
  reason: string;
  seen: number;
  of: number;
  quote: { text: string; who: string; url: string; number: number } | null;
  examples: { number: number; url: string }[];
};

/** What the model found by reading the pull request threads (the AI part of the plan). */
export type PlanAi = {
  read_on: string;
  threads: number;
  /** One per engine field: how outsiders are treated, the contributor guide, the kind of project. */
  signals: { kind: string; value: string; headline: string; text: string; tone: Tone | "neutral"; url: string | null }[];
  /** How the threads it read ended, by the engine's outcome values, most common first. */
  outcomes: { value: string; count: number }[];
  quotes: { text: string; url: string; number: number; outcome: string }[];
};

export type MergePlan = {
  repo: string;
  recorded_on: string;
  generated_at: string;
  /** `since`: the oldest pull request the counts read, not the start of the search window. */
  window: { days: number; since: string };
  sample: { merged: number; closed: number; merged_outside: number; closed_outside: number };
  note: string | null;
  verdict: { verdict: Verdict; headline: string; tone: Tone; line: string; numbers: { value: string; label: string }[] };
  call: { text: string; sources: PlanSource[] };
  steps: PlanStep[];
  merged: PlanFact[];
  closed: PlanClosing[];
  reviewers: { people: { login: string; reviewed: number; of: number; areas: string[] }[]; sources: PlanSource[] };
  ai: PlanAi | null;
};

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
