import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePending, toFollow, withoutPending, withPending, type PendingCheck } from "./pending-checks.ts";

const NOW = 1_800_000_000_000;
const check = (job: string, repo = "pallets/flask", at = NOW): PendingCheck => ({ job, repo, mode: "rules", days: 7, at });

test("the list survives a round trip and drops junk and old checks", () => {
  const list = [check("a"), check("b", "psf/requests", NOW - 60_000)];
  assert.deepEqual(parsePending(JSON.stringify(list), NOW), list);
  assert.deepEqual(parsePending(JSON.stringify([...list, check("old", "x/y", NOW - 21 * 60_000)]), NOW), list);
  assert.deepEqual(parsePending(JSON.stringify([{ job: 1 }, "x", null]), NOW), []);
  assert.deepEqual(parsePending("{not json", NOW), []);
  assert.deepEqual(parsePending(null, NOW), []);
});

test("adding a job again replaces it; removing takes it out", () => {
  let list = withPending([], check("a"));
  list = withPending(list, { ...check("a"), days: 30 });
  assert.equal(list.length, 1);
  assert.equal(list[0].days, 30);
  assert.deepEqual(withoutPending(list, "a"), []);
});

test("the report page open follows its own check; the watcher follows the rest", () => {
  const list = [check("a", "Pallets/Flask"), check("b", "psf/requests")];
  assert.deepEqual(toFollow(list, "/pallets/flask").map((c) => c.job), ["b"]);
  assert.deepEqual(toFollow(list, "/me").map((c) => c.job), ["a", "b"]);
});
