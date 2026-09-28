// The merge plan: the redesigned AI report (paid, written by holt-pro).
// DRAFT shape for the design review. The contract goes into API.md with the
// holt-pro endpoint that fills it; until then only the example page uses it.
import type { PlaybookSource, Tone, Verdict } from "./types";

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

export type MergePlan = {
  repo: string;
  recorded_on: string;
  generated_at: string;
  model: string;
  window: { days: number; since: string };
  sample: { merged: number; closed: number; merged_outside: number; closed_outside: number };
  note: string | null;
  verdict: { verdict: Verdict; headline: string; tone: Tone; line: string; numbers: { value: string; label: string }[] };
  call: { text: string; sources: PlanSource[] };
  steps: PlanStep[];
  merged: PlanFact[];
  closed: PlanClosing[];
  reviewers: { people: { login: string; reviewed: number; of: number; areas: string[] }[]; sources: PlanSource[] };
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
