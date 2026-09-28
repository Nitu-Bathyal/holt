import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedLabel, recentChecks } from "./recent-checks.ts";

const row = (repo: string, day: number) => ({ repo, generated_at: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z` });

test("newest first, one row per repo", () => {
  const r = recentChecks([row("a/one", 1), row("b/two", 3), row("A/One", 5), row("c/three", 2)]);
  assert.deepEqual(r.recent.map((x) => x.repo), ["A/One", "b/two", "c/three"]);
  assert.equal(r.checked, 3);
  assert.equal(r.capped, false);
});

test("shows at most `shown` and knows when the list was cut off", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(`o/r${i}`, i + 1));
  const r = recentChecks(rows, 5, 2);
  assert.equal(r.recent.length, 2);
  assert.equal(r.capped, true);
});

test("the count in words", () => {
  assert.equal(checkedLabel({ checked: 0, capped: false }), "");
  assert.equal(checkedLabel({ checked: 1, capped: false }), "1 repo checked so far");
  assert.equal(checkedLabel({ checked: 126, capped: false }), "126 repos checked so far");
  assert.equal(checkedLabel({ checked: 480, capped: true }), "480+ repos checked so far");
});
