import assert from "node:assert/strict";
import { test } from "node:test";
import { hintState, nextHint, type HintEvent } from "./quick-check.ts";

const run = (path: string, ...events: HintEvent[]) => events.reduce(nextHint, hintState(path));

test("an empty or unreadable submit shows the hint; a good one doesn't", () => {
  assert.equal(run("/me", { type: "submit", valid: false }).shown, true);
  assert.equal(run("/me", { type: "submit", valid: true }).shown, false);
  assert.equal(run("/me", { type: "submit", valid: false }, { type: "submit", valid: true }).shown, false);
});

test("typing clears the hint at once", () => {
  assert.equal(run("/me", { type: "submit", valid: false }, { type: "input" }).shown, false);
});

test("leaving the box (blur or Escape) clears the hint", () => {
  assert.equal(run("/me", { type: "submit", valid: false }, { type: "leave" }).shown, false);
});

test("moving to another page clears the hint, and coming back doesn't bring it back", () => {
  const s = run("/me", { type: "submit", valid: false }, { type: "route", path: "/find" });
  assert.equal(s.shown, false);
  assert.equal(nextHint(s, { type: "route", path: "/me" }).shown, false);
});

test("a re-render on the same page keeps the hint and the same state object", () => {
  const s = run("/me", { type: "submit", valid: false });
  assert.equal(nextHint(s, { type: "route", path: "/me" }), s);
  assert.equal(nextHint(s, { type: "submit", valid: false }), s);
});
