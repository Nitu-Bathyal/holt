import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE, proItems } from "../app/pricing/copy.ts";

const SOLD = [
  { id: "merge_plan", name: "Merge plan", per_month: 30, unlimited: false },
  { id: "pr_watch", name: "PR watch", per_month: null, unlimited: true },
  { id: "repo_watch", name: "Repo watch", per_month: null, unlimited: true },
  { id: "issue_watch", name: "Issue watch", per_month: null, unlimited: true },
];

test("Pro lists the watches first, and the merge plan's number comes from the server", () => {
  const items = proItems(SOLD);
  assert.deepEqual(items.map((i) => i.id), ["pr_watch", "repo_watch", "issue_watch", "merge_plan"]);
  assert.equal(items[3].title, "Merge plans, 30 a month");
  assert.equal(proItems([{ ...SOLD[0], per_month: 12 }])[0].title, "Merge plans, 12 a month");
  for (const i of items) assert.ok(i.line.length > 20, i.id);
});

test("with nothing on sale, Pro is described without a number", () => {
  const items = proItems([]);
  assert.deepEqual(items.map((i) => i.title), ["PR watch", "Repo watch", "Issue watch", "Merge plans"]);
});

test("a feature the page has no words for still shows by name, last", () => {
  const items = proItems([{ id: "new_thing", name: "New thing", per_month: null, unlimited: true }, SOLD[1]]);
  assert.deepEqual(items.map((i) => i.title), ["PR watch", "New thing"]);
});

test("no retired words on the pricing page", () => {
  const text = [...FREE, ...proItems(SOLD)].map((i) => `${i.title} ${i.line}`).join(" ");
  assert.doesNotMatch(text, /\bAI\b|credit|weekly/i);
});
