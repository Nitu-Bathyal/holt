import assert from "node:assert/strict";
import { test } from "node:test";
import { holtUsersLine, windowLabel } from "./holt-users.ts";

const base = { people: 9, pull_requests: 12, merged: 7, closed: 5, waiting: 0, window_days: 365, computed_at: "2026-09-27T00:00:00Z" };

test("merged of all, and who made them up", () => {
  assert.equal(holtUsersLine(base), "7 of 12 merged (from 9 people)");
});

test("says how many are still open", () => {
  assert.equal(holtUsersLine({ ...base, closed: 2, waiting: 3 }), "7 of 12 merged, 3 still open (from 9 people)");
});

test("window in plain words", () => {
  assert.equal(windowLabel(365), "the last 12 months");
  assert.equal(windowLabel(90), "the last 90 days");
});
