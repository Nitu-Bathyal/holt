import assert from "node:assert/strict";
import { test } from "node:test";
import { appendPart, chunks, failedParts, FROM_START, loadingParts, restoreParts, SAVED_MAX_AGE_MS, saveParts, startParts, type Part } from "./parts.ts";

type Repo = { repo: string };
const id = (r: Repo) => r.repo.toLowerCase();
const part = (names: string[], next: string | null, total = 7): Part<Repo> => ({ items: names.map((repo) => ({ repo })), next, total });
const names = (s: { items: Repo[] }) => s.items.map((r) => r.repo);
const ERR = { code: "upstream" as const, message: "Couldn't reach Holt." };

test("the next part is added after what is already listed", () => {
  const first = startParts(part(["a/1", "a/2"], "c1"));
  assert.deepEqual([first.status, first.next, first.total], ["idle", "c1", 7]);
  const loading = loadingParts(first);
  assert.equal(loading.status, "loading");
  const second = appendPart(loading, "c1", part(["a/3", "a/4"], "c2"), id);
  assert.deepEqual(names(second), ["a/1", "a/2", "a/3", "a/4"]);
  assert.deepEqual([second.status, second.next], ["idle", "c2"]);
  assert.deepEqual(chunks(second).map((c) => c.map((r) => r.repo)), [["a/1", "a/2"], ["a/3", "a/4"]]);
});

test("a repo is never listed twice, whatever its casing", () => {
  const s = appendPart(loadingParts(startParts(part(["a/1", "a/2"], "c1"))), "c1", part(["A/2", "a/3", "a/3"], "c2"), id);
  assert.deepEqual(names(s), ["a/1", "a/2", "a/3"]);
  assert.deepEqual(s.sizes, [2, 1]);
});

test("a part that arrives twice, or for a cursor the list has left, changes nothing", () => {
  const loading = loadingParts(startParts(part(["a/1"], "c1")));
  const once = appendPart(loading, "c1", part(["a/2"], "c2"), id);
  assert.equal(appendPart(once, "c1", part(["a/2"], "c2"), id), once);
  assert.equal(failedParts(once, "c1", ERR), once);
});

test("the end: no next cursor, the total as the server last gave it, and nothing more to load", () => {
  const end = appendPart(loadingParts(startParts(part(["a/1"], "c1"))), "c1", part(["a/2"], null, 2), id);
  assert.deepEqual([end.next, end.total, end.status], [null, 2, "idle"]);
  assert.equal(loadingParts(end), end);
});

test("a server that answers the same cursor with nothing new is the end, not a loop", () => {
  const s = appendPart(loadingParts(startParts(part(["a/1"], "c1"))), "c1", part(["a/1"], "c1"), id);
  assert.equal(s.next, null);
  // Nothing new but a new cursor: carry on from it.
  const on = appendPart(loadingParts(startParts(part(["a/1"], FROM_START))), FROM_START, part(["a/1"], "c2"), id);
  assert.deepEqual([names(on), on.next], [["a/1"], "c2"]);
});

test("a failed part keeps the list and can be asked for again", () => {
  const failed = failedParts(loadingParts(startParts(part(["a/1"], "c1"))), "c1", ERR);
  assert.deepEqual([failed.status, failed.error, failed.next, names(failed)], ["error", ERR, "c1", ["a/1"]]);
  const retried = loadingParts(failed);
  assert.deepEqual([retried.status, retried.error], ["loading", null]);
  assert.deepEqual(names(appendPart(retried, "c1", part(["a/2"], null), id)), ["a/1", "a/2"]);
});

test("coming back restores the loaded parts on top of the first part the page has now", () => {
  const left = appendPart(loadingParts(startParts(part(["a/1", "a/2"], "c1"))), "c1", part(["a/3", "a/4"], "c2"), id);
  const saved = saveParts(left, 1800, 1000);
  assert.ok(saved);
  // The first part changed meanwhile: a/3 moved up into it.
  const back = restoreParts(part(["a/1", "a/3"], "c1"), JSON.parse(JSON.stringify(saved)), id, 2000);
  assert.ok(back);
  assert.deepEqual(names(back), ["a/1", "a/3", "a/4"]);
  assert.deepEqual([back.next, back.sizes, back.status], ["c2", [2, 1], "idle"]);
});

test("nothing is restored from a list that never loaded a second part, an old one, or none", () => {
  const first = part(["a/1"], "c1");
  assert.equal(saveParts(startParts(first), 0, 0), null);
  assert.equal(restoreParts(first, null, id, 0), null);
  const saved = saveParts(appendPart(loadingParts(startParts(first)), "c1", part(["a/2"], null), id), 0, 0);
  assert.ok(restoreParts(first, saved, id, SAVED_MAX_AGE_MS));
  assert.equal(restoreParts(first, saved, id, SAVED_MAX_AGE_MS + 1), null);
  // Everything saved is already in the first part now.
  assert.equal(restoreParts(part(["a/1", "a/2"], null), saved, id, 1), null);
});
