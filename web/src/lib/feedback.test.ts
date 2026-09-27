import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanReason, feedbackKey, parseFeedback, REASON_MAX } from "./feedback.ts";

const ok = { repo: "pallets/flask", mode: "rules", days: 7, generated_at: "2026-09-25T00:00:00Z", vote: "down" };

test("accepts a vote with or without a reason", () => {
  assert.deepEqual(parseFeedback(ok), { ...ok, reason: null });
  assert.equal(parseFeedback({ ...ok, reason: "  never  merges\noutsiders " })?.reason, "never merges outsiders");
  assert.equal(parseFeedback({ ...ok, mode: undefined, days: undefined })?.days, 7);
  assert.equal(parseFeedback({ ...ok, mode: "ai" })?.mode, "ai");
});

test("rejects anything malformed", () => {
  for (const bad of [
    null,
    "up",
    { ...ok, vote: "meh" },
    { ...ok, vote: undefined },
    { ...ok, repo: "not a repo" },
    { ...ok, repo: "../../v1/me" },
    { ...ok, mode: "turbo" },
    { ...ok, days: 0 },
    { ...ok, days: 7.5 },
    { ...ok, generated_at: "" },
    { ...ok, generated_at: "x".repeat(41) },
    { ...ok, reason: 42 },
  ]) {
    assert.equal(parseFeedback(bad), null, JSON.stringify(bad));
  }
});

test("reasons are trimmed, capped, and blank means none", () => {
  assert.equal(cleanReason("   "), null);
  assert.equal(cleanReason(undefined), null);
  assert.equal(cleanReason("x".repeat(900))?.length, REASON_MAX);
});

test("the remembered answer is per report version", () => {
  const a = feedbackKey("Pallets/Flask", "rules", 7, "2026-09-25T00:00:00Z");
  assert.equal(a, feedbackKey("pallets/flask", "rules", 7, "2026-09-25T00:00:00Z"));
  assert.notEqual(a, feedbackKey("pallets/flask", "rules", 7, "2026-09-26T00:00:00Z"));
});
