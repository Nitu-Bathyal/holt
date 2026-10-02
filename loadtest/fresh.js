// Scenario 2, fresh checks: a burst of repos staging has never checked, all
// asked for at the same moment, each by its own signed-out visitor. Measures
// how long a check takes from the click to the report when it has to queue.
//
//   FRESH_MAX=6          how many repos from repos/fresh.txt (15 at most)
//   FRESH_SKIP=0         start further down the list (a repo is fresh once)
//   FRESH_REPOS=a/b,c/d  use these instead of the file
//
// Costs GitHub points on staging's tokens: about 10 a check, up to about 20.
// Signed-out checks are limited to 10 an hour per address; more are refused.
import { openTarget } from "./lib/target.js";
import { TREND_STATS } from "./lib/windows.js";
import { freshRepos, keepChecks, runCheck } from "./lib/check.js";
import { summarise } from "./lib/summary.js";

const repos = freshRepos();

export const options = {
  scenarios: {
    checks: { executor: "per-vu-iterations", vus: repos.length, iterations: 1, maxDuration: "20m" },
  },
  thresholds: keepChecks,
  summaryTrendStats: TREND_STATS,
};

export function setup() {
  return { target: openTarget(), started: Date.now() };
}

export default function (data) {
  runCheck(repos, data.target);
}

export const handleSummary = summarise({ scenario: "fresh", windows: [], pages: [], withChecks: true });
