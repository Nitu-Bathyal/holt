// Scenario 1, readers: people opening pages Holt already has. The landing
// page, Discover, Find's shared default search, the examples, and cached
// reports, with the number of virtual users stepped up (10, 50, 100, 200) and
// each step held long enough to read its latency and error rate.
//
//   STEPS=10,50,100,200  STEP_SECONDS=45  RAMP_SECONDS=10
//   THINK_MIN=0.5 THINK_MAX=1.5   a virtual user's pause between pages, seconds
//
// Costs no GitHub points: nothing here starts a check or a search.
import { openTarget } from "./lib/target.js";
import { GIVE_UP, TREND_STATS, keep, ramp, windowNow } from "./lib/windows.js";
import { PAGES, prime, view } from "./lib/pages.js";
import { summarise } from "./lib/summary.js";

const { stages, windows } = ramp();

export const options = {
  scenarios: {
    readers: { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "5s", gracefulStop: "10s" },
  },
  thresholds: { ...keep(windows, PAGES), ...GIVE_UP },
  summaryTrendStats: TREND_STATS,
  setupTimeout: "5m",
};

export function setup() {
  const target = openTarget();
  return { target, mix: prime(target), started: Date.now() };
}

export default function (data) {
  view(data.mix, data.target, windowNow(windows));
}

export const handleSummary = summarise({ scenario: "readers", windows, pages: PAGES, withChecks: false });
