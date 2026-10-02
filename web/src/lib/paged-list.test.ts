import assert from "node:assert/strict";
import { test } from "node:test";
import { ended, failed, loaded, loading, startList, wanted, withoutRepeats, type Paged } from "./paged-list.ts";

const key = (s: string) => s.toLowerCase();
const first = (): Paged<string> => startList({ items: ["a/a", "b/b"], next: 2 }, key);

test("the first part is the list, ready for the next", () => {
  assert.deepEqual(first(), { items: ["a/a", "b/b"], next: 2, status: "idle", parts: 1 });
  assert.equal(wanted(first()), 2);
  assert.equal(ended(first()), false);
});

test("a list whose first part is all of it has ended", () => {
  const all = startList({ items: ["a/a"], next: null }, key);
  assert.equal(ended(all), true);
  assert.equal(wanted(all), null);
  assert.equal(loading(all), all);
});

test("parts are added in order, and the last one ends the list", () => {
  let list = loading(first());
  assert.equal(list.status, "loading");
  list = loaded(list, 2, { items: ["c/c", "d/d"], next: 4 }, key);
  assert.deepEqual(list, { items: ["a/a", "b/b", "c/c", "d/d"], next: 4, status: "idle", parts: 2 });
  list = loaded(loading(list), 4, { items: ["e/e"], next: null }, key);
  assert.deepEqual(list.items, ["a/a", "b/b", "c/c", "d/d", "e/e"]);
  assert.equal(ended(list), true);
  assert.equal(list.parts, 3);
});

test("an item that comes again is shown once, where it first was", () => {
  assert.deepEqual(withoutRepeats(["a/a"], ["A/A", "b/b", "b/b"], key), ["a/a", "b/b"]);
  assert.deepEqual(startList({ items: ["a/a", "A/a"], next: null }, key).items, ["a/a"]);
  const list = loaded(loading(first()), 2, { items: ["B/B", "c/c"], next: 4 }, key);
  assert.deepEqual(list.items, ["a/a", "b/b", "c/c"]);
  assert.equal(list.next, 4);
});

test("a part of nothing but repeats still moves on", () => {
  const list = loaded(loading(first()), 2, { items: ["a/a"], next: 4 }, key);
  assert.deepEqual(list.items, ["a/a", "b/b"]);
  assert.equal(wanted(list), 4);
});

test("only one part is asked for at a time", () => {
  const list = loading(first());
  assert.equal(wanted(list), null);
  assert.equal(loading(list), list);
});

test("an answer nobody is waiting for changes nothing", () => {
  const idle = first();
  assert.equal(loaded(idle, 2, { items: ["c/c"], next: 4 }, key), idle);
  // The same part asked for twice: the second answer is dropped.
  const once = loaded(loading(first()), 2, { items: ["c/c"], next: 4 }, key);
  assert.equal(loaded(once, 2, { items: ["c/c"], next: 4 }, key), once);
  assert.equal(failed(once, 2), once);
  // An answer for another part than the one on its way.
  const waiting = loading(once);
  assert.equal(loaded(waiting, 2, { items: ["x/x"], next: 9 }, key), waiting);
});

test("a failed part keeps the list and can be asked for again", () => {
  const list = failed(loading(first()), 2);
  assert.deepEqual(list, { items: ["a/a", "b/b"], next: 2, status: "failed", parts: 1 });
  assert.equal(wanted(list), 2);
  const again = loaded(loading(list), 2, { items: ["c/c"], next: null }, key);
  assert.deepEqual(again.items, ["a/a", "b/b", "c/c"]);
  assert.equal(again.status, "idle");
});

test("a part that points back at itself ends the list", () => {
  const list = loaded(loading(first()), 2, { items: ["c/c"], next: 2 }, key);
  assert.equal(ended(list), true);
});

test("the place the next part starts can be anything, not only a number", () => {
  const list = startList<string, string>({ items: ["a/a"], next: "after-a" }, key);
  const more = loaded(loading(list), "after-a", { items: ["b/b"], next: null }, key);
  assert.deepEqual(more.items, ["a/a", "b/b"]);
});
