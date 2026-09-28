import assert from "node:assert/strict";
import { test } from "node:test";
import { countAt, countParts, settle } from "./count-up.ts";

test("a stat splits into words and the numbers that count", () => {
  assert.deepEqual(countParts("3 of 12"), [{ n: 3, decimals: 0, final: "3" }, { text: " of " }, { n: 12, decimals: 0, final: "12" }]);
  assert.deepEqual(countParts("12.5%"), [{ n: 12.5, decimals: 1, final: "12.5" }, { text: "%" }]);
  assert.deepEqual(countParts("No replies"), [{ text: "No replies" }]);
});

test("a counting number keeps its final format and ends exactly on it", () => {
  const [n] = countParts("12.5%");
  if (!("n" in n)) throw new Error("expected a number");
  assert.equal(countAt(n, 0), "0.0");
  assert.equal(countAt(n, 0.5), "6.3");
  assert.equal(countAt(n, 1), "12.5");
  assert.equal(countAt(n, 2), "12.5");
});

test("the easing starts at 0 and settles at 1", () => {
  assert.equal(settle(0), 0);
  assert.equal(settle(1), 1);
  assert.ok(settle(0.5) > 0.5);
});
