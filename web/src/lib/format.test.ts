import assert from "node:assert/strict";
import { test } from "node:test";
import { creditsNote, evidenceLabel, mergeTone, noReplyTone, statLines } from "./format.ts";

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

// Flask: 0 left open unanswered, 99 closed without a word. Two tiles that
// can't be read as opposites.
test("open with no reply and closed without a word are separate tiles", () => {
  const lines = statLines({ ...stats(171, 5, 0), closed_silently: 99 });
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  assert.equal(byKey.noreply.label, "of outside PRs sat open with no reply (0)");
  assert.equal(byKey.closed.big, "58%");
  assert.equal(byKey.closed.label, "of outside PRs were closed without a word (99)");
  assert.equal(lines.length, 6);
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

test("creditsNote says free only when every credit is free", () => {
  const c = { ai_available: true, balance: 13, can_claim: false, claim_every_days: 7, free: 3, next_claim_at: null, purchased: 10 };
  assert.equal(creditsNote(c), "13 AI reports left. This one uses 1. A failed report doesn't count.");
  assert.equal(creditsNote({ ...c, balance: 3, purchased: 0 }), "3 free AI reports left. This one uses 1. A failed report doesn't count.");
  assert.equal(creditsNote({ ...c, balance: 1, free: 1, purchased: 0 }).startsWith("1 free AI report left."), true);
});
