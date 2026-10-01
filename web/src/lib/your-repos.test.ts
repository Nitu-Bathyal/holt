import assert from "node:assert/strict";
import { test } from "node:test";
import { compareHref, parseShow, repoNumbers, reposTitle, shown, yourRepos, verdictFirst } from "./your-repos.ts";
import type { DiscoverRepo, HistoryItem, SavedItem, Stats } from "./types";

const check = (repo: string, at: string, over: Partial<HistoryItem> = {}): HistoryItem => ({
  job_id: `${repo}-${at}`, status: "done", repo, mode: "rules", days: 7, verdict: "viable",
  headline: "Worth your time", tone: "good", created_at: at, ...over,
} as HistoryItem);
const save = (repo: string, at: string, card: unknown = null): SavedItem => ({ repo, saved_at: at, card } as SavedItem);

test("saved and checked repos make one list, one row per repo, newest activity first", () => {
  const rows = yourRepos(
    [save("pallets/flask", "2026-09-20"), save("octo/new", "2026-09-28")],
    [check("Pallets/Flask", "2026-09-25", { mode: "ai" }), check("pallets/flask", "2026-09-10"), check("psf/requests", "2026-09-22")],
  );
  assert.deepEqual(rows.map((r) => [r.repo.toLowerCase(), r.savedAt, r.checkedAt]), [
    ["octo/new", "2026-09-28", null],
    ["pallets/flask", "2026-09-20", "2026-09-25"],
    ["psf/requests", null, "2026-09-22"],
  ]);
  assert.equal(rows[1].ai, true);
  assert.equal(rows[0].headline, null); // saved, never checked
});

test("a saved repo's current free report wins over an old check", () => {
  const card = { repo: "pallets/flask", headline: "Not worth your time", tone: "bad", stats: { outsider_merged: 5 } };
  const rows = yourRepos([save("pallets/flask", "2026-09-01", card)], [
    check("pallets/flask", "2026-09-02"),
    check("x/failed", "2026-09-03", { status: "error", headline: null, tone: null }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].headline, "Not worth your time");
  assert.equal(rows[0].tone, "bad");
});

test("a check still running shows on its repo's row, at the top", () => {
  const now = Date.parse("2026-09-29T12:10:00Z");
  const rows = yourRepos([save("a/saved", "2026-09-29T12:00:00Z")], [
    check("x/new", "2026-09-29T12:05:00Z", { status: "running", headline: null, tone: null }),
    check("pallets/flask", "2026-09-29T12:08:00Z", { status: "queued", headline: null, tone: null }),
    check("pallets/flask", "2026-09-20T00:00:00Z"),
    check("old/stuck", "2026-09-29T10:00:00Z", { status: "running", headline: null, tone: null }),
  ], [], now);
  assert.deepEqual(rows.map((r) => [r.repo, r.checking]), [["pallets/flask", true], ["x/new", true], ["a/saved", false]]);
  // Its last verdict stays until the new one lands.
  assert.equal(rows[0].headline, "Worth your time");
  assert.deepEqual(shown(rows, "checked").map((r) => r.repo), ["pallets/flask", "x/new"]);
});

test("a finished check newer than the running one's start isn't shown as running", () => {
  const now = Date.parse("2026-09-29T12:10:00Z");
  const rows = yourRepos([], [
    check("a/b", "2026-09-29T12:05:00Z"),
    check("a/b", "2026-09-29T12:01:00Z", { status: "running", headline: null, tone: null }),
  ], [], now);
  assert.equal(rows[0].checking, false);
});

test("tabs filter; anything unknown shows all", () => {
  const rows = yourRepos([save("a/saved", "2026-09-02")], [check("b/checked", "2026-09-01")]);
  assert.deepEqual(shown(rows, "saved").map((r) => r.repo), ["a/saved"]);
  assert.deepEqual(shown(rows, "checked").map((r) => r.repo), ["b/checked"]);
  assert.equal(shown(rows, "all").length, 2);
  assert.equal(parseShow("saved"), "saved");
  assert.equal(parseShow(["checked"]), "checked");
  assert.equal(parseShow("nope"), "all");
  assert.equal(parseShow(undefined), "all");
});

test("the title counts repos, and compare needs two to four", () => {
  assert.equal(reposTitle([]), "No repos yet.");
  assert.equal(reposTitle(yourRepos([save("a/b", "1")], [])), "1 repo you saved or checked.");
  assert.equal(compareHref(["a/b"]), null);
  assert.equal(compareHref(["a/b", "c/d"]), "/compare?repos=a/b,c/d");
  assert.equal(compareHref(["a/1", "a/2", "a/3", "a/4", "a/5"]), "/compare?repos=a/1,a/2,a/3,a/4");
});

test("a repo you only checked gets its numbers and stars from the history's cards", () => {
  const card = { repo: "Pallets/Flask", headline: "Long shot", tone: "warn", stars: 68000, stats: { outsider_attempts: 12, outsider_merged: 4 } } as DiscoverRepo;
  const other = { ...card, repo: "not/checked" } as DiscoverRepo;
  const rows = yourRepos([], [check("pallets/flask", "2026-09-25")], [card, other]);
  assert.equal(rows.length, 1); // a card for a repo you never checked adds no row
  assert.deepEqual([rows[0].repo, rows[0].stars, rows[0].stats?.outsider_merged, rows[0].tone], ["Pallets/Flask", 68000, 4, "warn"]);
  const bare = yourRepos([], [check("psf/requests", "2026-09-25")]);
  assert.deepEqual([bare[0].stats, bare[0].stars], [null, null]);
});

test("the numbers in place of a verdict, in plain words", () => {
  const stats = (over: Partial<Stats>) => ({ outsider_attempts: 12, outsider_merged: 4, median_first_response_hours: 50, ...over } as Stats);
  assert.deepEqual(repoNumbers(stats({})), { merged: "4 of 12 outside PRs merged", reply: "first reply in 2 days" });
  assert.deepEqual(repoNumbers(stats({ median_first_response_hours: null })), { merged: "4 of 12 outside PRs merged", reply: "no replies yet" });
  assert.deepEqual(repoNumbers(stats({ outsider_attempts: 0, outsider_merged: 0 })), { merged: "no outside PRs yet", reply: null });
});

test("rows carry the verdict, and the ones with no way in say it instead of numbers", () => {
  const card = { repo: "a/b", headline: "Personal project", tone: "neutral", verdict: "personal", stats: { outsider_attempts: 0 } } as DiscoverRepo;
  const rows = yourRepos([save("a/b", "2026-09-01", card)], [check("c/d", "2026-09-02", { verdict: "not_viable", headline: "Not worth your time", tone: "bad" })]);
  assert.deepEqual(rows.map((r) => [r.repo, r.verdict, verdictFirst(r)]), [["c/d", "not_viable", true], ["a/b", "personal", true]]);
  for (const v of ["viable", "long_shot", "catalogue"] as const) assert.equal(verdictFirst({ verdict: v, headline: "x" }), false, v);
  assert.equal(verdictFirst({ verdict: "insufficient_evidence", headline: "Not enough evidence" }), true);
  assert.equal(verdictFirst({ verdict: null, headline: null }), false);
});
