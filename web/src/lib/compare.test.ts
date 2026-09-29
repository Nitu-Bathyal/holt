import assert from "node:assert/strict";
import { test } from "node:test";
import { compareHref, leaders, parseList } from "./compare.ts";
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
  assert.deepEqual(l, { merged: [0, 3], reply: [1], firstTimers: [1], silent: [3] });
});

test("no leader with one column, equal numbers or missing ones", () => {
  assert.deepEqual(leaders([st()]), { merged: [], reply: [], firstTimers: [], silent: [] });
  assert.deepEqual(leaders([st(), st()]).merged, []);
  assert.deepEqual(leaders([st({ median_first_response_hours: null }), st()]).reply, []);
  assert.deepEqual(leaders([st({ outsider_attempts: 0 }), st()]).merged, []);
});
