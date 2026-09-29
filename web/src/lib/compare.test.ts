import assert from "node:assert/strict";
import { test } from "node:test";
import { cells, compareHref, compareTitle, leaders, parseList, ROWS } from "./compare.ts";
import { humanHours } from "./format.ts";
import type { Stats } from "./types.ts";

const st = (over: Partial<Stats> = {}): Stats => ({ outsider_attempts: 10, outsider_merged: 5, distinct_outsiders: 8, first_time_merged_authors: 2, no_reply: 1, median_first_response_hours: 10, bot_share: 0, still_open: 0, closed_silently: 0, too_old: 0, ...over });

test("parseList takes names and URLs, split by commas or spaces, without duplicates", () => {
  assert.deepEqual(parseList("pallets/flask https://github.com/psf/requests, Pallets/Flask"), ["pallets/flask", "psf/requests"]);
  assert.deepEqual(parseList(["a/b,c/d", "e/f g/h i/j"]), ["a/b", "c/d", "e/f", "g/h"]);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList("not a repo"), []);
});

test("compareHref", () => {
  assert.equal(compareHref([]), "/compare");
  assert.equal(compareHref(["a/b", "c/d"]), "/compare?repos=a/b,c/d");
});

test("leaders mark the best column on each number, ties included", () => {
  const l = leaders([st({ outsider_merged: 8 }), st({ median_first_response_hours: 2, first_time_merged_authors: 9 }), null, st({ no_reply: 0, outsider_merged: 8 })]);
  assert.deepEqual(l, { merged: [0, 3], reply: [1], firstTimers: [1], silent: [3], closed: [] });
});

test("no leader with one column, equal numbers or missing ones", () => {
  assert.deepEqual(leaders([st()]), { merged: [], reply: [], firstTimers: [], silent: [], closed: [] });
  assert.deepEqual(leaders([st(), st()]).merged, []);
  assert.deepEqual(leaders([st({ median_first_response_hours: null }), st()]).reply, []);
  assert.deepEqual(leaders([st({ outsider_attempts: 0 }), st()]).merged, []);
});

test("compareTitle names the one repo that merges outsiders most often, once you picked", () => {
  const repos = ["a/b", "c/d"];
  const lead = leaders([st({ outsider_merged: 8 }), st()]);
  assert.equal(compareTitle(true, repos, lead), "a/b merges outsiders most often.");
  // The example on an empty page, a tie, or a single repo keep the question.
  assert.equal(compareTitle(false, repos, lead), "Which one will review your pull request?");
  assert.equal(compareTitle(true, repos, leaders([st(), st()])), "Which one will review your pull request?");
  assert.equal(compareTitle(true, ["a/b"], leaders([st()])), "Which one will review your pull request?");
});

test("fewest closed without a word leads", () => {
  assert.deepEqual(leaders([st({ closed_silently: 1 }), st({ closed_silently: 4 })]).closed, [0]);
});

test("cells: a share to scan with what it's out of, and plain words where there's no number", () => {
  const c = cells({ stats: st({ outsider_merged: 8, outsider_attempts: 20, median_first_response_hours: 30 }), landing: [{ path: "docs" } as never] });
  assert.deepEqual(c.merged, { main: "40%", sub: "8 of 20" });
  assert.equal(c.reply.main, humanHours(30));
  assert.equal(c.way.main, "docs/");
  assert.equal(cells({ stats: st(), landing: [{ path: "(root)" } as never] }).way.main, "(root)");
  const quiet = cells({ stats: st({ median_first_response_hours: null, first_time_merged_authors: 0 }), landing: [] });
  assert.deepEqual(quiet.reply, { main: "no replies", tone: "bad" });
  assert.equal(quiet.firstTimers.tone, "bad");
  assert.deepEqual(quiet.way, { main: "none yet", tone: "none" });
  const empty = cells({ stats: st({ outsider_attempts: 0, outsider_merged: 0, median_first_response_hours: null }), landing: [] });
  assert.equal(empty.merged.tone, "none");
  assert.equal(empty.silent.main, "–");
  assert.equal(empty.reply.tone, "none");
});

test("every row has a cell", () => {
  const c = cells({ stats: st(), landing: [] });
  for (const r of ROWS) assert.ok(c[r.id], r.id);
});
