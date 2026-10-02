import assert from "node:assert/strict";
import { test } from "node:test";
import { reportKnownChecker } from "./report-known.ts";

function counting(reports: Set<string>) {
  const calls: string[] = [];
  return { calls, probe: async (repo: string) => (calls.push(repo), reports.has(repo.toLowerCase())) };
}

test("a report that exists is remembered, whatever the casing", async () => {
  const { probe, calls } = counting(new Set(["pallets/flask"]));
  let t = 0;
  const known = reportKnownChecker({ probe, now: () => t, knownMs: 1000 });
  assert.equal(await known("pallets/flask"), true);
  assert.equal(await known("Pallets/Flask"), true);
  assert.equal(calls.length, 1);
  t = 1000;
  assert.equal(await known("pallets/flask"), true);
  assert.equal(calls.length, 2, "asked again once it's old");
});

test("a missing report is asked for again every time", async () => {
  const reports = new Set<string>();
  const { probe, calls } = counting(reports);
  const known = reportKnownChecker({ probe });
  assert.equal(await known("octo/new"), false);
  assert.equal(await known("octo/new"), false);
  assert.equal(calls.length, 2);
  reports.add("octo/new"); // the first check finished
  assert.equal(await known("octo/new"), true);
});

test("a lookup that fails counts as no report", async () => {
  const known = reportKnownChecker({ probe: async () => { throw new Error("down"); } });
  assert.equal(await known("pallets/flask"), false);
});

test("requests that arrive together share one lookup", async () => {
  const { probe, calls } = counting(new Set(["a/b"]));
  const known = reportKnownChecker({ probe });
  assert.deepEqual(await Promise.all([known("a/b"), known("a/b"), known("A/B")]), [true, true, true]);
  assert.equal(calls.length, 1);
});

test("only so many are remembered", async () => {
  const { probe, calls } = counting(new Set(["a/1", "a/2", "a/3"]));
  const known = reportKnownChecker({ probe, maxEntries: 2 });
  for (const r of ["a/1", "a/2", "a/3"]) await known(r);
  await known("a/3");
  assert.equal(calls.length, 3);
  await known("a/1"); // the oldest was dropped
  assert.equal(calls.length, 4);
});
