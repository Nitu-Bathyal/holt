import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME_REDIRECT_CACHE, afterSignIn, fastestReplies, landingRedirect, nextStep, replyLine, setupLeft, setupSteps, showProfilePrompt, type HomeState } from "./home.ts";
import type { ContributionPR, DiscoverRepo } from "./types";

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

test("/ sends signed-in people home, and nobody else", () => {
  assert.equal(landingRedirect(true, undefined), "/me");
  assert.equal(landingRedirect(false, undefined), null);
  // The escape hatch, in any spelling.
  assert.equal(landingRedirect(true, "1"), null);
  assert.equal(landingRedirect(true, ""), null);
  assert.equal(landingRedirect(true, ["1"]), null);
  assert.equal(landingRedirect(false, "1"), null);
});

test("the redirect from / is never cached for anyone else", () => {
  const parts = HOME_REDIRECT_CACHE.split(",").map((p) => p.trim());
  assert.ok(parts.includes("private") && parts.includes("no-store"));
  assert.ok(!parts.some((p) => p === "public" || p.startsWith("s-maxage") || p.startsWith("max-age")));
});

test("the profile prompt shows until it's saved or skipped", () => {
  assert.equal(showProfilePrompt({ hasProfile: false, skipped: false }), true);
  assert.equal(showProfilePrompt({ hasProfile: false, skipped: true }), false);
  assert.equal(showProfilePrompt({ hasProfile: true, skipped: false }), false);
  // Server couldn't say: don't ask.
  assert.equal(showProfilePrompt({ hasProfile: null, skipped: false }), false);
});

const pr = (repo: string, created_at: string) => ({ repo, created_at, state: "open" }) as ContributionPR;
const fresh: HomeState = { checked: 0, hasProfile: false, connected: false, waiting: [], topPick: null };
const ago = () => "3 days ago";

test("setup steps: signing in is already done, the rest follow the account", () => {
  const day1 = setupSteps(fresh);
  assert.deepEqual(day1.map((s) => [s.id, s.done]), [["signin", true], ["check", false], ["profile", false], ["github", false]]);
  assert.equal(setupLeft(day1), 3);
  assert.equal(setupLeft(setupSteps({ ...fresh, checked: 2, hasProfile: true, connected: true })), 0);
  // Unknown profile doesn't nag.
  assert.equal(setupSteps({ ...fresh, hasProfile: null }).find((s) => s.id === "profile")!.done, true);
});

test("next step: first check, then a waiting pull request, then the profile, then a pick", () => {
  assert.equal(nextStep(fresh, ago).href, "#check");
  // Even with a waiting PR, a first check comes first.
  assert.equal(nextStep({ ...fresh, waiting: [pr("a/b", "x")] }, ago).href, "#check");

  const checked = { ...fresh, checked: 1 };
  const waiting = nextStep({ ...checked, waiting: [pr("pallets/flask", "x"), pr("a/b", "y")] }, ago);
  assert.equal(waiting.href, "/pallets/flask");
  assert.match(waiting.title, /pallets\/flask is still waiting/);
  assert.match(waiting.body, /3 days ago/);

  assert.equal(nextStep(checked, ago).href, "/settings#profile");
  assert.equal(nextStep({ ...checked, hasProfile: true, topPick: { repo: "o/r", reason: "Why." } }, ago).href, "/o/r");
  assert.equal(nextStep({ ...checked, hasProfile: true }, ago).href, "/find");
  assert.equal(nextStep({ ...checked, hasProfile: null }, ago).href, "/find");
});

const repo = (name: string, verdict: string, hours: number | null) =>
  ({ repo: name, verdict, stats: { median_first_response_hours: hours } }) as unknown as DiscoverRepo;

test("fastest replies: only repos worth your time with a measured reply, quickest first", () => {
  const out = fastestReplies([repo("a/slow", "viable", 30), repo("b/none", "viable", null), repo("c/fast", "viable", 0.5), repo("d/no", "not_viable", 0.1)]);
  assert.deepEqual(out.map((r) => r.repo), ["c/fast", "a/slow"]);
  assert.equal(fastestReplies([repo("a/a", "viable", 1), repo("b/b", "viable", 2)], 1).length, 1);
});

test("reply line in plain words", () => {
  assert.equal(replyLine(null), null);
  assert.equal(replyLine(3), "Outsiders usually get a reply in 3 hours.");
});
