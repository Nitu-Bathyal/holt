import assert from "node:assert/strict";
import { test } from "node:test";
import { inputMood } from "./cat.ts";

test("the cat reads along with a repo box", () => {
  assert.equal(inputMood("", false), null);
  assert.equal(inputMood("   ", false), null);
  assert.equal(inputMood("pall", false), null);
  assert.equal(inputMood("pallets/flask", true), "celebrating");
  assert.equal(inputMood("pallets flask", false), "thinking");
  assert.equal(inputMood("not-a-repo-at-all", false), "thinking");
});
