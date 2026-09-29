import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignIn, dismissedNudges, groupPulls, homeKind, homeNudge, outsidePulls, primaryAction, pullCountLine, statusLine } from "./home.ts";
import type { ContributionPR } from "./types";

test("sign-in without somewhere to go back to lands on the home", () => {
  assert.equal(afterSignIn(undefined), "/me");
  assert.equal(afterSignIn(null), "/me");
  assert.equal(afterSignIn(""), "/me");
  assert.equal(afterSignIn("/"), "/me");
  assert.equal(afterSignIn([]), "/me");
});

test("a safe callbackUrl wins: signing in from a report goes back to it", () => {
  assert.equal(afterSignIn("/pallets/flask?mode=ai"), "/pallets/flask?mode=ai");
  assert.equal(afterSignIn("/pricing?buy=credits_10"), "/pricing?buy=credits_10");
  assert.equal(afterSignIn("/settings"), "/settings");
  assert.equal(afterSignIn("/?landing=1"), "/?landing=1");
  assert.equal(afterSignIn(["/me/history", "/x"]), "/me/history");
});

test("an unsafe callbackUrl falls back to the home, never off-site", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "javascript:alert(1)"]) {
    assert.equal(afterSignIn(bad), "/me", bad);
  }
});


test("new until there's something to come back to: a check, a saved repo or a pull request", () => {
  assert.equal(homeKind({ checked: 0, saved: 0, pulls: 0 }), "new");
  assert.equal(homeKind({ checked: 1, saved: 0, pulls: 0 }), "returning");
  assert.equal(homeKind({ checked: 0, saved: 2, pulls: 0 }), "returning");
  assert.equal(homeKind({ checked: 0, saved: 0, pulls: 1 }), "returning");
});

test("one primary action: new asks for the profile, then finds a project; returning checks a repo", () => {
  assert.equal(primaryAction("new", { hasProfile: false, skipped: false }), "profile");
  assert.equal(primaryAction("new", { hasProfile: false, skipped: true }), "find");
  assert.equal(primaryAction("new", { hasProfile: true, skipped: false }), "find");
  // Server couldn't say: don't ask.
  assert.equal(primaryAction("new", { hasProfile: null, skipped: false }), "find");
  for (const hasProfile of [false, true, null]) assert.equal(primaryAction("returning", { hasProfile, skipped: false }), "check");
});

test("at most one nudge: the profile first, then GitHub, never repeating the primary action", () => {
  const base = { primary: "check" as const, hasProfile: false, connected: false, dismissed: [] as string[] };
  assert.equal(homeNudge(base), "profile");
  assert.equal(homeNudge({ ...base, primary: "profile" }), "github");
  assert.equal(homeNudge({ ...base, hasProfile: true }), "github");
  assert.equal(homeNudge({ ...base, hasProfile: null }), "github");
  assert.equal(homeNudge({ ...base, dismissed: ["profile"] }), "github");
  assert.equal(homeNudge({ ...base, hasProfile: true, connected: true }), null);
  assert.equal(homeNudge({ ...base, dismissed: ["profile", "github"] }), null);
});

test("dismissed nudges come from their cookie, and only known ones", () => {
  assert.deepEqual(dismissedNudges(undefined), []);
  assert.deepEqual(dismissedNudges("github,profile,evil"), ["github", "profile"]);
});

test("the status line: waiting PRs and AI reports left, in plain words", () => {
  assert.equal(statusLine({ waiting: 1, credits: { balance: 3, ai_available: true } }), "1 PR waiting for a reply · 3 AI reports left");
  assert.equal(statusLine({ waiting: 2, credits: { balance: 1, ai_available: false } }), "2 PRs waiting for a reply");
  assert.equal(statusLine({ waiting: 0, credits: { balance: 1, ai_available: true } }), "1 AI report left");
  assert.equal(statusLine({ waiting: 0, credits: null }), "");
});

const pull = (repo: string, number: number, state: ContributionPR["state"], created: string): ContributionPR => ({
  repo, number, state, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, draft: false,
  created_at: created, closed_at: null, merged_at: state === "merged" ? created : null, verdict: null, found_via_holt: false,
  counted: true, not_counted_because: null,
});

test("pull requests to your own repos are left out, whatever the case", () => {
  const all = [pull("Octo/tool", 1, "merged", "2026-09-01"), pull("pallets/flask", 2, "open", "2026-09-02")];
  assert.deepEqual(outsidePulls(all, "octo").map((p) => p.number), [2]);
  assert.equal(outsidePulls(all, null).length, 2);
});

test("pull requests group by repo: waiting ones first, then the newest", () => {
  const groups = groupPulls([
    pull("a/old", 1, "merged", "2026-09-01"),
    pull("b/busy", 2, "merged", "2026-09-10"),
    pull("B/Busy", 3, "merged", "2026-09-12"),
    pull("c/waiting", 4, "open", "2026-08-01"),
    pull("b/busy", 5, "closed", "2026-09-05"),
  ]);
  assert.deepEqual(groups.map((g) => g.repo), ["c/waiting", "B/Busy", "a/old"]);
  const busy = groups[1];
  assert.deepEqual(busy.pulls.map((p) => p.number), [3, 2, 5]);
  assert.equal(pullCountLine(busy), "3 pull requests: 2 merged, 1 closed, not merged");
  assert.equal(pullCountLine(groups[0]), "1 pull request: 1 waiting");
});
