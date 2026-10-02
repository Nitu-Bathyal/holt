// Scenario 3, mixed: a steady crowd of readers, and a burst of fresh checks
// landing in the middle of it. Compares what readers get before the burst
// with what they get while the checks run.
//
//   MIXED_VUS=50         readers, held for the whole run
//   BEFORE_SECONDS=45    readers alone
//   DURING_SECONDS=120   readers while the checks run
//   FRESH_MAX=4          checks in the burst (see fresh.js for the rest)
//
// Costs GitHub points like fresh.js.
import { openTarget } from "./lib/target.js";
import { GIVE_UP, TREND_STATS, keep, windowNow } from "./lib/windows.js";
import { PAGES, prime, view } from "./lib/pages.js";
import { freshRepos, keepChecks, runCheck } from "./lib/check.js";
import { summarise } from "./lib/summary.js";

const vus = Number(__ENV.MIXED_VUS || 50);
const before = Number(__ENV.BEFORE_SECONDS || 45);
const during = Number(__ENV.DURING_SECONDS || 120);
const repos = freshRepos(4);

// The first seconds are left out of "before": the readers all start at once.
const windows = [
  { name: "before", vus, from: 5, to: before },
  { name: "during", vus, from: before, to: before + during },
];

export const options = {
  scenarios: {
    readers: { executor: "constant-vus", vus, duration: `${before + during}s`, gracefulStop: "10s", exec: "reader" },
    checks: { executor: "per-vu-iterations", vus: repos.length, iterations: 1, startTime: `${before}s`, maxDuration: "20m", exec: "checker" },
  },
  thresholds: { ...keep(windows, PAGES), ...keepChecks, ...GIVE_UP },
  summaryTrendStats: TREND_STATS,
  setupTimeout: "5m",
};

export function setup() {
  const target = openTarget();
  return { target, mix: prime(target), started: Date.now() };
}

export function reader(data) {
  view(data.mix, data.target, windowNow(windows));
}

export function checker(data) {
  runCheck(repos, data.target);
}

export const handleSummary = summarise({ scenario: "mixed", windows, pages: PAGES, withChecks: true });
