import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStep } from "./format.ts";

const starter = (people: number | null, open_prs: number | null, comments = 0) => ({
  number: 1, title: "t", url: "u", labels: [], created_at: null, comments, why: [],
  people, open_prs, on_it: null, beginner: true, areas: [],
});

test("the next step for an issue someone is already on", () => {
  assert.equal(nextStep(starter(1, 1)), "Look at the open pull request first; if it has stalled, ask to take over.");
  assert.equal(nextStep(starter(2, 0, 4)), "Ask whether it's still free before you start.");
  assert.equal(nextStep(starter(0, 0)), "Comment on the issue to ask if you can take it.");
  assert.equal(nextStep(starter(null, null)), "Comment on the issue to ask if you can take it.");
});
