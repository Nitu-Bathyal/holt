import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignIn, alsoForYou, dismissedNudges, homeNudge, moveLead, moveTitle, nextMove, othersInFlight, outsidePulls, statusLine, waiting, waitPhrase } from "./home.ts";
import type { YourRepo } from "./your-repos.ts";
import type { ContributionPR } from "./types";
import type { Timing } from "./api-schema";

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
  counted: true, not_counted_because: null, turn: "unknown", turn_at: null, first_reply_at: null, last_activity_at: null, review_decision: null,
});

test("pull requests to your own repos are left out, whatever the case", () => {
  const all = [pull("Octo/tool", 1, "merged", "2026-09-01"), pull("pallets/flask", 2, "open", "2026-09-02")];
  assert.deepEqual(outsidePulls(all, "octo").map((p) => p.number), [2]);
  assert.equal(outsidePulls(all, null).length, 2);
});

const NOW = Date.parse("2026-10-05T12:00:00Z");
// Most get a first reply within 15 hours; about half are merged within 6 days, most merged ones within 30.
const TIMING = { first_reply_half_hours: 5, first_reply_slow_hours: 15, merge_half_days: 6, merge_slow_days: 30 } as Timing;
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const pr = (repo: string, state: ContributionPR["state"], openedHoursAgo: number, over: Partial<ContributionPR> = {}): ContributionPR => ({
  repo, number: openedHoursAgo, state, title: `PR to ${repo}`, url: `https://github.com/${repo}/pull/${openedHoursAgo}`, draft: false,
  created_at: hoursAgo(openedHoursAgo), closed_at: null, merged_at: null, found_via_holt: false, counted: true, not_counted_because: null,
  verdict: { verdict: "viable", headline: "Worth your time", tone: "good", checked_at: hoursAgo(1), first_reply_hours: 10, timing: TIMING },
  turn: "theirs", turn_at: hoursAgo(openedHoursAgo), first_reply_at: null, last_activity_at: hoursAgo(openedHoursAgo), review_decision: null,
  ...over,
} as ContributionPR);
const repo = (name: string, tone: YourRepo["tone"], saved: boolean): YourRepo => ({
  repo: name, savedAt: saved ? hoursAgo(10) : null, checkedAt: saved ? null : hoursAgo(10), ai: false, checking: false,
  headline: tone === "good" ? "Worth your time" : "Not worth your time", tone, stats: null, stars: null, at: hoursAgo(10),
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
  assert.equal(moveLead(m), "Day 3, no reply yet. Most get one within 15 hours here.");
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
  assert.equal(moveLead(calm), "Day 1, no reply yet. Most get one within 15 hours here.");
  const unknown = nextMove({ pulls: [pr("c/new", "open", 30, { verdict: null })], repos: [], now: NOW });
  assert.equal(moveTitle(unknown), "Your PR to c/new is *waiting.*"); // no timing: never late
  assert.equal(moveLead(unknown), null);
});

test("your turn leads, and is never late", () => {
  const late = pr("b/late", "open", 40);
  const yours = pr("c/yours", "open", 400, { turn: "yours", turn_at: hoursAgo(48), first_reply_at: hoursAgo(380) });
  const m = nextMove({ pulls: [late, yours], repos: [], now: NOW });
  assert.equal(m.kind === "waiting" && m.wait.pr.repo, "c/yours");
  assert.equal(moveTitle(m), "It's *your turn* on c/yours.");
  assert.equal(moveLead(m), "Your turn: a reviewer replied 2 days ago.");
  assert.equal(m.kind === "waiting" && m.wait.late, false);
  const changes = waiting({ ...yours, review_decision: "changes_requested" }, NOW);
  assert.equal(changes.line, "Your turn: a reviewer asked for changes 2 days ago.");
});

test("the bug: a PR reviewed on day 1 and waiting on its author isn't late", () => {
  // Opened 9 days ago; a maintainer replied the next day; the author hasn't answered.
  const w = waiting(pr("a/x", "open", 9 * 24, { turn: "yours", turn_at: hoursAgo(8 * 24), first_reply_at: hoursAgo(8 * 24) }), NOW);
  assert.equal(w.late, false);
  assert.equal(w.turn, "yours");
  // Replied and the author answered: waiting on the merge, measured against merge times, not replies.
  const back = waiting(pr("a/x", "open", 9 * 24, { first_reply_at: hoursAgo(8 * 24), turn_at: hoursAgo(7 * 24) }), NOW);
  assert.equal(back.late, false);
  assert.equal(back.line, "Day 10. Most merged ones land within 5 weeks here.");
});

test("no reply yet: against the slow first reply, late past it", () => {
  const t = { ...TIMING, first_reply_slow_hours: 72 };
  const at = (h: number) => waiting(pr("a/x", "open", h, { verdict: { ...pr("a/x", "open", 1).verdict!, timing: t } }), NOW);
  assert.deepEqual([at(8 * 24).line, at(8 * 24).late], ["Day 9, no reply yet. Most get one within 3 days here.", true]);
  assert.deepEqual([at(48).line, at(48).late], ["Day 3, no reply yet. Most get one within 3 days here.", false]);
  assert.equal(at(72).late, false); // at the mark, not past it
  // Only the half mark known: said, never late.
  const half = waiting(pr("a/x", "open", 500, { verdict: { ...pr("a/x", "open", 1).verdict!, timing: { ...TIMING, first_reply_slow_hours: null } } }), NOW);
  assert.deepEqual([half.line, half.late], ["Day 21, no reply yet. About half get one within 5 hours here.", false]);
});

test("replied, waiting on the merge: the half mark, then the slow one", () => {
  const replied = (days: number) => waiting(pr("a/x", "open", days * 24, { first_reply_at: hoursAgo(days * 24 - 1) }), NOW);
  assert.deepEqual([replied(4).line, replied(4).late], ["Day 5. About half are merged within 6 days here.", false]);
  assert.deepEqual([replied(20).line, replied(20).late], ["Day 21. Most merged ones land within 5 weeks here.", false]);
  assert.deepEqual([replied(40).line, replied(40).late], ["Day 41. Most merged ones land within 5 weeks here.", true]);
  const noMerges = waiting(pr("a/x", "open", 100, { first_reply_at: hoursAgo(90), verdict: { ...pr("a/x", "open", 1).verdict!, timing: { first_reply_slow_hours: 15 } as Timing } }), NOW);
  assert.deepEqual([noMerges.line, noMerges.late], [null, false]);
});

test("quiet close to the repo's stale bot: said, and late", () => {
  const t = { ...TIMING, stale_bot: true, stale_close_days: 30 };
  const quiet = (days: number) => waiting(pr("a/x", "open", 40 * 24, { first_reply_at: hoursAgo(39 * 24), last_activity_at: hoursAgo(days * 24), verdict: { ...pr("a/x", "open", 1).verdict!, timing: t } }), NOW);
  assert.deepEqual([quiet(24).line, quiet(24).late], ["Quiet for 24 days. The bot here closes at 30.", true]);
  assert.equal(quiet(23).line, "Quiet for 23 days. The bot here closes at 30.");
  assert.equal(quiet(20).line, "Day 41. Most merged ones land within 5 weeks here."); // not close yet
});

test("nothing to say: no report, no timing, a draft, or Holt couldn't read the PR", () => {
  for (const over of [{ verdict: null }, { verdict: { ...pr("a/x", "open", 1).verdict!, timing: null } }, { draft: true }, { turn: "unknown" as const }]) {
    const w = waiting(pr("a/x", "open", 200, over), NOW);
    assert.deepEqual([w.line, w.late, w.mark], [null, false, null], JSON.stringify(over));
  }
});

test("waits in plain words, rounded up", () => {
  assert.deepEqual([0.5, 5.2, 21, 23, 30, 72, 13 * 24, 15 * 24, 60 * 24].map(waitPhrase), ["an hour", "6 hours", "21 hours", "a day", "2 days", "3 days", "13 days", "3 weeks", "2 months"]);
});

test("also for you: your turn and other late PRs, and saved repos that turned; in flight: the rest", () => {
  const lead = pr("b/late", "open", 60);
  const alsoLate = pr("c/late", "open", 40);
  const yours = pr("e/yours", "open", 10, { turn: "yours", first_reply_at: hoursAgo(2), turn_at: hoursAgo(2) });
  const fine = pr("a/fine", "open", 5);
  const pulls = [lead, alsoLate, fine];
  const repos = [repo("pallets/flask", "bad", true), repo("x/checked-bad", "bad", false)];
  let m = nextMove({ pulls, repos, now: NOW });
  const also = alsoForYou(m, { pulls, repos, now: NOW });
  assert.deepEqual(also.map((a) => (a.kind === "pr" ? a.wait.pr.repo : a.repo.repo)), ["c/late", "pallets/flask"]);
  assert.deepEqual(othersInFlight(m, pulls, NOW).map((w) => w.pr.repo), ["a/fine"]);
  m = nextMove({ pulls: [...pulls, yours], repos, now: NOW });
  assert.equal(m.kind === "waiting" && m.wait.pr.repo, "e/yours");
  assert.deepEqual(alsoForYou(m, { pulls: [...pulls, yours], repos, now: NOW }).map((a) => (a.kind === "pr" ? a.wait.pr.repo : a.repo.repo)), ["b/late", "c/late", "pallets/flask"]);
});

test("your checks running or just finished lead Also for you", () => {
  const running: YourRepo = { ...repo("a/running", "good", false), checking: true };
  const ready: YourRepo = { ...repo("b/ready", "good", false), checkedAt: hoursAgo(0.5) };
  const older: YourRepo = { ...repo("c/older", "good", false), checkedAt: hoursAgo(2) };
  const turned = repo("d/turned", "bad", true);
  const repos = [running, ready, older, turned];
  const m = nextMove({ pulls: [], repos, now: NOW });
  const also = alsoForYou(m, { pulls: [], repos, now: NOW });
  assert.deepEqual(also.map((a) => [a.kind, a.kind === "pr" ? a.wait.pr.repo : a.repo.repo]), [
    ["checking", "a/running"], ["ready", "b/ready"], ["turned", "d/turned"],
  ]);
});
