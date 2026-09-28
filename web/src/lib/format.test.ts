import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceLabel, mergeTone, noReplyTone, statLines } from "./format.ts";

const stats = (attempts: number, merged: number, noReply: number) => ({
  outsider_attempts: attempts, outsider_merged: merged, no_reply: noReply,
  distinct_outsiders: attempts, first_time_merged_authors: merged, median_first_response_hours: 5, bot_share: 0,
});

// The server's odds (server/tests/test_server_schema.py) use these thresholds too.
test("tile thresholds match the server's odds", () => {
  assert.equal(mergeTone(12), "good");
  assert.equal(mergeTone(11), "warn");
  assert.equal(mergeTone(5), "warn");
  assert.equal(mergeTone(4), "bad");
  assert.equal(noReplyTone(25), "good");
  assert.equal(noReplyTone(50), "warn");
  assert.equal(noReplyTone(51), "bad");
});

test("flask-like numbers colour the tiles honestly", () => {
  const tones = Object.fromEntries(statLines(stats(189, 5, 100)).map((l) => [l.key, l.tone]));
  assert.equal(tones.merged, "bad");
  assert.equal(tones.noreply, "bad");
});

test("partial stats (find results) only show what they have", () => {
  const keys = statLines({ outsider_merged: 4, outsider_attempts: 10 }).map((l) => l.key);
  assert.deepEqual(keys, ["merged"]);
});

test("evidence labels are plain words, never the engine's values", () => {
  assert.deepEqual(evidenceLabel({ kind: "outcome", value: "closed_dismissive" }),
    { label: "Closed with no way forward", bad: true });
  assert.deepEqual(evidenceLabel({ kind: "outcome", value: "merged_after_review" }),
    { label: "Merged after review", bad: false });
  assert.equal(evidenceLabel({ kind: "repo_kind", value: "real_software" }).label, "Kind of project");
  assert.equal(evidenceLabel({ kind: "onboarding", value: "boilerplate" }).label, "Contributor guide");
});
