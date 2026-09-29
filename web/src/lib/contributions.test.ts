import assert from "node:assert/strict";
import { test } from "node:test";
import { cooldownLabel, foundViaHoltLine, landedLine, landedPct, minutesLeft, prGroups, prsTitle } from "./contributions.ts";
import type { ContributionPR } from "./types";

const summary = (merged: number, closed: number, share: number | null) => ({
  opened: merged + closed + 1, merged, closed, waiting: 1, landed_share: share, found_via_holt: 0, not_counted: 0,
});

test("landed counts only decided pull requests", () => {
  assert.equal(landedLine(summary(0, 0, null)), null);
  assert.equal(landedLine(summary(3, 2, 0.6)), "3 of 5 decided got merged");
  assert.equal(landedPct(summary(3, 2, 0.6)), 60);
  assert.equal(landedPct(summary(0, 0, null)), null);
});

test("cooldown rounds up and ends", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  assert.equal(minutesLeft(null, now), 0);
  assert.equal(minutesLeft("2026-09-27T09:59:00Z", now), 0);
  assert.equal(minutesLeft("2026-09-27T10:00:10Z", now), 1);
  assert.equal(minutesLeft("2026-09-27T10:14:01Z", now), 15);
  assert.equal(minutesLeft("not a date", now), 0);
  assert.equal(cooldownLabel(0), "");
  assert.equal(cooldownLabel(1), "you can refresh again in 1 minute");
  assert.equal(cooldownLabel(12), "you can refresh again in 12 minutes");
});

test("found via Holt line", () => {
  assert.equal(foundViaHoltLine(0), null);
  assert.match(foundViaHoltLine(1) ?? "", /^1 of them/);
  assert.match(foundViaHoltLine(4) ?? "", /^4 of them/);
});

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const pr = (repo: string, state: ContributionPR["state"], hours: number, over: Partial<ContributionPR> = {}): ContributionPR => ({
  repo, number: hours, state, title: `PR ${hours}`, url: `https://github.com/${repo}/pull/${hours}`, draft: false,
  created_at: ago(hours), closed_at: state === "open" ? null : ago(hours - 1), merged_at: state === "merged" ? ago(hours - 1) : null,
  found_via_holt: false, counted: true, not_counted_because: null,
  verdict: { verdict: "viable", headline: "Worth your time", tone: "good", checked_at: ago(1), first_reply_hours: 10 },
  ...over,
} as ContributionPR);

test("your PRs group by next move, and repos left out collect at the bottom", () => {
  const g = prGroups([
    pr("a/late", "open", 30),
    pr("b/fine", "open", 5),
    pr("c/merged", "merged", 100),
    pr("c/merged", "merged", 50),
    pr("d/closed", "closed", 200),
    pr("friend/hack", "merged", 20, { counted: false, not_counted_because: "you" }),
    pr("friend/hack", "open", 3, { counted: false, not_counted_because: "you" }),
    pr("me/team", "merged", 40, { counted: false, not_counted_because: "own_project" }),
  ], NOW);
  assert.deepEqual(g.needs.map((w) => w.pr.repo), ["a/late"]);
  assert.deepEqual(g.waiting.map((w) => w.pr.repo), ["b/fine"]);
  assert.deepEqual(g.merged.map((p) => p.number), [50, 100]); // newest decision first
  assert.deepEqual(g.closed.map((p) => p.repo), ["d/closed"]);
  assert.deepEqual(g.notCounted.map((n) => [n.repo, n.because, n.pulls.length]), [["friend/hack", "you", 2], ["me/team", "own_project", 1]]);
  assert.equal(prsTitle(g), "1 PR is *waiting longer than usual.*");
});

test("the page's sentence steps down from what needs you to nothing yet", () => {
  const t = (pulls: ContributionPR[]) => prsTitle(prGroups(pulls, NOW));
  assert.equal(t([pr("a/1", "open", 30), pr("a/2", "open", 40)]), "2 PRs are *waiting longer than usual.*");
  assert.equal(t([pr("a/1", "open", 2)]), "1 PR is *waiting for a reply.*");
  assert.equal(t([pr("a/1", "merged", 50), pr("a/2", "merged", 60)]), "2 merged. *Nothing needs you.*");
  assert.equal(t([pr("a/1", "closed", 50)]), "Nothing open. *Time for the next one.*");
  assert.equal(t([]), "No pull requests *yet.*");
  assert.equal(t([pr("x/y", "open", 99, { counted: false, not_counted_because: "you" })]), "No pull requests *yet.*");
});
