import assert from "node:assert/strict";
import { test } from "node:test";
import { statLines } from "./format.ts";

// Flask: 0 left open unanswered, 99 closed without a word. Two tiles that
// can't be read as opposites.
test("open with no reply and closed without a word are separate tiles", () => {
  const lines = statLines({
    outsider_attempts: 171, outsider_merged: 5, no_reply: 0, closed_silently: 99,
    distinct_outsiders: 147, first_time_merged_authors: 4, median_first_response_hours: 0.7, bot_share: 0,
  });
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  assert.equal(byKey.noreply.label, "of outside PRs sat open with no reply (0)");
  assert.equal(byKey.closed.big, "58%");
  assert.equal(byKey.closed.label, "of outside PRs were closed without a word (99)");
  assert.equal(lines.length, 6);
});
