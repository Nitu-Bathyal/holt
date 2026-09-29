import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignIn, alsoForYou, dismissedNudges, homeNudge, moveLead, moveTitle, nextMove, othersInFlight, outsidePulls, statusLine } from "./home.ts";
import type { YourRepo } from "./your-repos.ts";
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


test("at most one nudge: the profile first, then GitHub, never the question the page is asking", () => {
  const base = { askingProfile: false, hasProfile: false, connected: false, dismissed: [] as string[] };
  assert.equal(homeNudge(base), "profile");
  assert.equal(homeNudge({ ...base, askingProfile: true }), "github");
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

const NOW = Date.parse("2026-10-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const pr = (repo: string, state: ContributionPR["state"], openedHoursAgo: number, over: Partial<ContributionPR> = {}): ContributionPR => ({
  repo, number: openedHoursAgo, state, title: `PR to ${repo}`, url: `https://github.com/${repo}/pull/${openedHoursAgo}`, draft: false,
  created_at: hoursAgo(openedHoursAgo), closed_at: null, merged_at: null, found_via_holt: false, counted: true, not_counted_because: null,
  verdict: { verdict: "viable", headline: "Worth your time", tone: "good", checked_at: hoursAgo(1), first_reply_hours: 15 },
  ...over,
} as ContributionPR);
const repo = (name: string, tone: YourRepo["tone"], saved: boolean): YourRepo => ({
  repo: name, savedAt: saved ? hoursAgo(10) : null, checkedAt: saved ? null : hoursAgo(10), ai: false,
  headline: tone === "good" ? "Worth your time" : "Not worth your time", tone, stats: null, at: hoursAgo(10),
});

test("the next move: a fresh merge, then an open PR, then a repo worth your time, then finding one", () => {
  const merged = pr("NixOS/nixpkgs", "merged", 200, { merged_at: hoursAgo(20) });
  const open = pr("home-assistant/core", "open", 50);
  const worth = repo("pallets/click", "good", true);
  let m = nextMove({ pulls: [merged, open], repos: [worth], now: NOW });
  assert.equal(m.kind, "merged");
  assert.equal(moveTitle(m), "NixOS/nixpkgs *merged your PR.*");
  assert.equal(moveLead(m), "PR to NixOS/nixpkgs. That's your 1st merged PR this year.");
  // Three days on, the open PR leads.
  m = nextMove({ pulls: [{ ...merged, merged_at: hoursAgo(80) }, open], repos: [worth], now: NOW });
  assert.equal(m.kind, "waiting");
  assert.equal(m.step, 3);
  assert.equal(moveTitle(m), "Your PR to home-assistant/core has *waited 2 days.*");
  assert.equal(moveLead(m), "Replies there usually come within 15 hours.");
  m = nextMove({ pulls: [], repos: [repo("x/checked", "good", false), worth], now: NOW });
  assert.deepEqual(m, { kind: "issue", step: 1, repo: "pallets/click" }); // saved beats checked
  assert.equal(moveTitle(m), "Next: pick an issue in *click.*");
  m = nextMove({ pulls: [], repos: [repo("pallets/flask", "bad", true)], now: NOW });
  assert.equal(moveTitle(m), "Let's find your *first repo.*");
  m = nextMove({ pulls: [pr("octo/old", "closed", 900)], repos: [], now: NOW });
  assert.equal(moveTitle(m), "Let's find your *next repo.*");
});

test("waiting: the most overdue PR leads; within the usual time it says so", () => {
  const fine = pr("a/fine", "open", 5);
  const late = pr("b/late", "open", 40);
  const m = nextMove({ pulls: [fine, late], repos: [], now: NOW });
  assert.equal(m.kind === "waiting" && m.wait.pr.repo, "b/late");
  const calm = nextMove({ pulls: [fine], repos: [], now: NOW });
  assert.equal(moveTitle(calm), "Your PR to a/fine is *waiting.*");
  assert.equal(moveLead(calm), "It's been 5 hours. Replies there usually come within 15 hours.");
  const unknown = nextMove({ pulls: [pr("c/new", "open", 30, { verdict: null })], repos: [], now: NOW });
  assert.equal(moveTitle(unknown), "Your PR to c/new has *waited about a day.*");
  assert.equal(moveLead(unknown), null);
});

test("also for you: other late PRs and saved repos that turned; in flight: the rest", () => {
  const lead = pr("b/late", "open", 60);
  const alsoLate = pr("c/late", "open", 40);
  const fine = pr("a/fine", "open", 5);
  const pulls = [lead, alsoLate, fine];
  const repos = [repo("pallets/flask", "bad", true), repo("x/checked-bad", "bad", false)];
  const m = nextMove({ pulls, repos, now: NOW });
  const also = alsoForYou(m, { pulls, repos, now: NOW });
  assert.deepEqual(also.map((a) => (a.kind === "late" ? a.wait.pr.repo : a.repo.repo)), ["c/late", "pallets/flask"]);
  assert.deepEqual(othersInFlight(m, pulls, NOW).map((w) => w.pr.repo), ["a/fine"]);
});
