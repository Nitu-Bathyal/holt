// A fresh check, the way a signed-out visitor's browser runs one: open the
// report page of a repo Holt hasn't checked, take the ticket the page hands
// out, start the check, and follow its events until the report arrives.
//
// Each one reads GitHub with staging's tokens: about 10 points, up to about
// 20 for a very busy repository (server/README.md, "GitHub cost, measured").
// So a burst is capped, and the per-IP limit on signed-out checks (10 an hour)
// caps it again.
import { fail } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { get, postJson } from "./target.js";
import { lines } from "./pages.js";
import { OUTCOMES } from "./summary.js";

/** From starting the check to having the report, queue included. */
export const checkTotal = new Trend("check_total_ms", true);
/** How long POST /api/analyses took to answer. */
export const checkStart = new Trend("check_start_ms", true);
/** Checks ahead of this one when it was queued. */
export const checkAhead = new Trend("check_queue_ahead");
/** One per repo, tagged with how it ended. */
export const checks = new Counter("fresh_checks");

// 15 checks at up to ~20 points each is the most that stays under 300 points.
const MOST = 15;

/** The repos to check: FRESH_REPOS, or repos/fresh.txt, cut to FRESH_MAX (default 6). */
export function freshRepos(fallbackMax = 6) {
  const all = __ENV.FRESH_REPOS ? __ENV.FRESH_REPOS.split(",").map((s) => s.trim()).filter(Boolean) : lines(open(import.meta.resolve("../repos/fresh.txt")));
  const max = Number(__ENV.FRESH_MAX || fallbackMax);
  if (!(max >= 1 && max <= MOST)) fail(`FRESH_MAX must be 1 to ${MOST}: each check costs GitHub points on staging's tokens`);
  const skip = Number(__ENV.FRESH_SKIP || 0);
  return all.slice(skip, skip + max);
}

export const keepChecks = {
  check_total_ms: ["max>=0"],
  check_start_ms: ["max>=0"],
  check_queue_ahead: ["max>=0"],
  ...Object.fromEntries(OUTCOMES.map((o) => [`fresh_checks{outcome:${o}}`, ["count>=0"]])),
};

/** Check `repos[n]`, where n is this iteration's number in its scenario. */
export function runCheck(repos, target) {
  const listed = repos[exec.scenario.iterationInTest];
  if (!listed) return;
  const tags = { step: "checks" };
  const page = get(`/${listed}`, target, { ...tags, page: "check_page" }, { timeout: "30s" });
  const body = typeof page.body === "string" ? page.body : "";
  // A renamed repo redirects to its new name, and the ticket is for that name.
  const landed = /^https?:\/\/[^/]+\/([^/?#]+\/[^/?#]+)/.exec(page.url || "");
  const repo = landed ? landed[1] : listed;
  // The ticket sits in the page's data, with its quotes escaped.
  const ticket = /ticket\\?":\\?"([0-9a-z]+\.[A-Za-z0-9_-]+)/.exec(body);
  if (!ticket) {
    const outcome = body.includes("data-verdict-hero") ? "cached" : "no_ticket";
    console.warn(`${repo}: ${outcome === "cached" ? "staging already has a report; nothing to check" : `no ticket on the page (status ${page.status})`}`);
    checks.add(1, { outcome });
    return;
  }

  const began = Date.now();
  const start = postJson("/api/analyses", { repo, mode: "rules", days: 7, ticket: ticket[1] }, target, { ...tags, page: "check_start" }, { timeout: "30s" });
  checkStart.add(start.timings.duration);
  if (start.status === 200) {
    checks.add(1, { outcome: "cached" });
    return;
  }
  if (start.status !== 202) {
    console.warn(`${repo}: the check was refused (status ${start.status}${start.status === 429 ? ", over the hourly limit" : ""})`);
    checks.add(1, { outcome: "refused" });
    return;
  }

  // The events stream ends with the report, so one long GET follows the whole check.
  const events = get(`/api/analyses/${encodeURIComponent(start.json("job_id"))}/events`, target, { ...tags, page: "check_events" }, {
    timeout: "900s",
    headers: { Accept: "text/event-stream" },
  });
  const stream = typeof events.body === "string" ? events.body : "";
  const position = /"queue_position":(\d+)/.exec(stream);
  checkAhead.add(position ? Number(position[1]) - 1 : 0);
  const outcome = /^event: done$/m.test(stream) ? "done" : "error";
  if (outcome === "error") console.warn(`${repo}: the check ended without a report (status ${events.status})`);
  checks.add(1, { outcome });
  checkTotal.add(Date.now() - began, { outcome });
}
