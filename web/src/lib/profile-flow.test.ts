import assert from "node:assert/strict";
import { test } from "node:test";
import { after, answer, BLANK, current, progress, QUESTIONS, toggle } from "./profile-flow.ts";

test("the flow goes start, each question in order, then done", () => {
  const seen = [];
  for (let s: ReturnType<typeof after> = "start"; s !== "done"; s = after(s)) seen.push(s);
  assert.deepEqual(seen, ["start", 0, 1, 2, 3]);
  assert.equal(after(QUESTIONS.length - 1), "done");
  assert.equal(after("done"), "done");
});

test("questions are languages, time, experience, then what to work on", () => {
  assert.deepEqual(QUESTIONS.map((q) => q.id), ["languages", "days", "level", "contributions"]);
  assert.equal(progress(0), "1 of 4");
  assert.equal(progress(3), "4 of 4");
});

test("each answer changes only its own field, so partial saves keep earlier answers", () => {
  const a = answer(BLANK, "languages", ["Python", "rust", "python"]);
  assert.deepEqual(a.languages, ["python", "rust"]);
  const b = answer(a, "days", "3");
  assert.equal(b.days, 3);
  assert.deepEqual(b.languages, ["python", "rust"]);
  const c = answer(b, "level", "experienced");
  assert.equal(c.level, "experienced");
  const d = answer(c, "contributions", ["docs", "nonsense", "code"]);
  assert.deepEqual(d.contributions, ["docs", "code"]);
  assert.deepEqual({ ...d, contributions: [] }, { ...c, contributions: [] });
});

test("a skipped question keeps the default", () => {
  // Skipping is moving on without answer(): what's saved is what was there.
  const p = answer(BLANK, "languages", ["go"]);
  assert.equal(p.days, BLANK.days);
  assert.equal(p.level, BLANK.level);
  assert.deepEqual(p.contributions, []);
});

test("bad values fall back to what was there", () => {
  assert.equal(answer(BLANK, "days", "12").days, 7);
  assert.equal(answer({ ...BLANK, level: "experienced" }, "level", "wizard").level, "experienced");
});

test("chips toggle and light up from the profile", () => {
  assert.deepEqual(toggle(["go"], "rust"), ["go", "rust"]);
  assert.deepEqual(toggle(["go", "rust"], "go"), ["rust"]);
  assert.deepEqual(current(BLANK, "days"), ["7"]);
  assert.deepEqual(current(BLANK, "level"), ["newcomer"]);
});
