import assert from "node:assert/strict";
import { test } from "node:test";
import { repoExistsChecker, type Probe } from "./repo-exists.ts";

function counting(answers: Record<string, "exists" | "missing" | "unknown">) {
  const calls: string[] = [];
  const probe: Probe = async (repo) => {
    calls.push(repo);
    return answers[repo.toLowerCase()] ?? "exists";
  };
  return { probe, calls };
}

test("only a 404 from GitHub counts as missing", async () => {
  const { probe } = counting({ "a/missing": "missing", "a/flaky": "unknown" });
  const exists = repoExistsChecker({ probe });
  assert.equal(await exists("a/missing"), false);
  assert.equal(await exists("a/flaky"), true);
  assert.equal(await exists("a/real"), true);
});

test("a probe that throws counts as exists", async () => {
  const exists = repoExistsChecker({ probe: async () => { throw new Error("network"); } });
  assert.equal(await exists("a/b"), true);
});

test("caches per repo, ignoring case, until the entry expires", async () => {
  let t = 0;
  const { probe, calls } = counting({ "a/gone": "missing" });
  const exists = repoExistsChecker({ probe, now: () => t, missingMs: 100, existsMs: 1000 });
  await exists("a/gone");
  await exists("A/Gone");
  await exists("a/real");
  assert.deepEqual(calls, ["a/gone", "a/real"]);
  t = 150;
  await exists("a/gone");
  await exists("a/real");
  assert.deepEqual(calls, ["a/gone", "a/real", "a/gone"]);
});

test("concurrent checks share one probe", async () => {
  const { probe, calls } = counting({});
  const exists = repoExistsChecker({ probe });
  await Promise.all([exists("a/b"), exists("a/b"), exists("A/B")]);
  assert.equal(calls.length, 1);
});

test("keeps at most maxEntries, dropping the oldest", async () => {
  const { probe, calls } = counting({});
  const exists = repoExistsChecker({ probe, maxEntries: 2 });
  await exists("a/1");
  await exists("a/2");
  await exists("a/3");
  await exists("a/1");
  assert.deepEqual(calls, ["a/1", "a/2", "a/3", "a/1"]);
});
