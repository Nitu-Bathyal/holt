import assert from "node:assert/strict";
import { test } from "node:test";
import { ttlMemo } from "./ttl-memo.ts";

test("one read serves every caller until it expires", async () => {
  let t = 0;
  let reads = 0;
  const get = ttlMemo(async () => (reads++, true), { ttlMs: 60_000, retryMs: 5_000, fallback: false, now: () => t });
  assert.deepEqual(await Promise.all([get(), get(), get()]), [true, true, true]);
  assert.equal(reads, 1);
  t = 59_999;
  assert.equal(await get(), true);
  assert.equal(reads, 1);
  t = 60_000;
  await get();
  assert.equal(reads, 2);
});

test("a failed read gives the fallback, then the last value, and retries sooner", async () => {
  let t = 0;
  let answer: boolean | null = null;
  let reads = 0;
  const get = ttlMemo(async () => (reads++, answer), { ttlMs: 60_000, retryMs: 5_000, fallback: false, now: () => t });
  assert.equal(await get(), false);
  t = 4_999;
  await get();
  assert.equal(reads, 1);
  t = 5_000;
  answer = true;
  assert.equal(await get(), true);
  t = 65_000;
  answer = null;
  assert.equal(await get(), true);
  assert.equal(reads, 3);
});

test("a read that throws counts as failed", async () => {
  const get = ttlMemo<boolean>(async () => { throw new Error("down"); }, { ttlMs: 60_000, retryMs: 5_000, fallback: false });
  assert.equal(await get(), false);
});
