import assert from "node:assert/strict";
import { test } from "node:test";
import { cooldownLabel, foundViaHoltLine, landedLine, landedPct, minutesLeft } from "./contributions.ts";

const summary = (merged: number, closed: number, share: number | null) => ({
  opened: merged + closed + 1, merged, closed, waiting: 1, landed_share: share, found_via_holt: 0, not_counted: 0,
});

test("landed counts only decided pull requests", () => {
  assert.equal(landedLine(summary(0, 0, null)), null);
  assert.equal(landedLine(summary(3, 2, 0.6)), "3 of 5 decided got merged");
  assert.equal(landedPct(summary(3, 2, 0.6)), 60);
  assert.equal(landedPct(summary(0, 0, null)), null);
});

test("cooldown rounds up and ends", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  assert.equal(minutesLeft(null, now), 0);
  assert.equal(minutesLeft("2026-09-27T09:59:00Z", now), 0);
  assert.equal(minutesLeft("2026-09-27T10:00:10Z", now), 1);
  assert.equal(minutesLeft("2026-09-27T10:14:01Z", now), 15);
  assert.equal(minutesLeft("not a date", now), 0);
  assert.equal(cooldownLabel(0), "");
  assert.equal(cooldownLabel(1), "you can refresh again in 1 minute");
  assert.equal(cooldownLabel(12), "you can refresh again in 12 minutes");
});

test("found via Holt line", () => {
  assert.equal(foundViaHoltLine(0), null);
  assert.match(foundViaHoltLine(1) ?? "", /^1 of them/);
  assert.match(foundViaHoltLine(4) ?? "", /^4 of them/);
});
