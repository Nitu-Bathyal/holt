// The curated example reports: the few reports anyone can read in full
// without signing in (every other report shows signed-out visitors a teaser;
// see gate.ts). One of each verdict, picked from repos with a current report,
// plus the recorded AI report at /example-ai-report. The verdict here only
// orders and labels the list; the page always shows what the rules say today.
// No runtime imports, so it runs under `node --test` and in the browser.
import type { Verdict } from "./types.ts";

export interface Example {
  repo: string;
  /** The verdict it had when picked, so the list keeps one of each. */
  verdict: Verdict;
  /** Why it's worth a look, in one line. */
  why: string;
}

export const EXAMPLES: Example[] = [
  { repo: "home-assistant/core", verdict: "viable", why: "A huge project that still replies to and merges outsiders." },
  { repo: "pallets/flask", verdict: "not_viable", why: "Famous and loved, but most outside pull requests don't get merged." },
  { repo: "vercel/next.js", verdict: "insufficient_evidence", why: "Busy, yet too few outside pull requests finished recently to say." },
];

export const EXAMPLES_PATH = "/examples";

export function isExample(repo: string): boolean {
  const r = repo.toLowerCase();
  return EXAMPLES.some((e) => e.repo.toLowerCase() === r);
}
