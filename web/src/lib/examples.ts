// The curated example reports: the few reports anyone can read in full
// without signing in (every other report shows signed-out visitors a teaser;
// see gate.ts). At least two of each verdict, picked from repos with a current report,
// plus the recorded AI report at /example-ai-report. The verdict here only
// orders and labels the list; the page always shows what the rules say today.
// No runtime imports, so it runs under `node --test` and in the browser.
import type { Verdict } from "./types.ts";

export interface Example {
  repo: string;
  /** The verdict it had when picked, so the list keeps at least two of each. */
  verdict: Verdict;
  /** GitHub's main language for the repo. */
  language: string;
  /** Stars when picked (rounded), shown as "★ 91k". */
  stars: number;
  /** Why it's worth a look, in one short line. */
  why: string;
}

export const EXAMPLES: Example[] = [
  { repo: "home-assistant/core", verdict: "viable", language: "Python", stars: 91_000, why: "Huge, and most outside PRs get merged." },
  { repo: "kubernetes/kubernetes", verdict: "viable", language: "Go", stars: 128_000, why: "Outsiders get merged, though many wait for a reply." },
  { repo: "sharkdp/bat", verdict: "viable", language: "Rust", stars: 61_000, why: "A small team that still merges outside fixes." },
  { repo: "pallets/flask", verdict: "not_viable", language: "Python", stars: 75_000, why: "Famous, but few outside PRs get merged." },
  { repo: "ollama/ollama", verdict: "not_viable", language: "Go", stars: 182_000, why: "Hugely popular, yet outside PRs go unanswered." },
  { repo: "vercel/next.js", verdict: "insufficient_evidence", language: "JavaScript", stars: 143_000, why: "Busy, but too few outside PRs finished to say." },
  { repo: "getsentry/sentry", verdict: "insufficient_evidence", language: "Python", stars: 45_000, why: "Too few outsiders tried recently. Holt won't guess." },
];

export const EXAMPLES_PATH = "/examples";

export function isExample(repo: string): boolean {
  const r = repo.toLowerCase();
  return EXAMPLES.some((e) => e.repo.toLowerCase() === r);
}
