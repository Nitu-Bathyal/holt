import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_REPORT } from "./example-report.ts";
import { buildReplay, cliHours, plainLine } from "./landing-replay.ts";

test("the terminal replay prints what `holt analyze` printed for the example repo", () => {
  // uv run holt analyze home-assistant/core --replay --no-model
  const r = buildReplay(EXAMPLE_REPORT);
  const text = r.terminal.map(plainLine);
  assert.equal(r.command, "holt analyze home-assistant/core --live --no-model");
  assert.ok(text.includes("Worth your time — for a contributor with 7 days."));
  assert.ok(text.includes("Evidence up to 2026-06-01."));
  assert.ok(text.includes("28 of 119 pull requests from outside contributors were merged."));
  assert.ok(text.includes("Of the 64 that got a reply, half heard back within 2.3 hours."));
  assert.ok(text.includes("55 got no reply at all."));
  assert.ok(text.includes("• homeassistant/components — 26 merged of 104 attempted (25%)"));
});

test("the web replay lands the report's own verdict and numbers", () => {
  const r = buildReplay(EXAMPLE_REPORT);
  assert.equal(r.headline, EXAMPLE_REPORT.headline);
  assert.equal(r.line, EXAMPLE_REPORT.verdict_line);
  assert.equal(r.stats[0].big, "28 of 119");
  assert.equal(r.stats.length, 3);
});

test("waits read the way the CLI writes them", () => {
  assert.equal(cliHours(0.8), "48 minutes");
  assert.equal(cliHours(2.3), "2.3 hours");
  assert.equal(cliHours(5), "5 hours");
  assert.equal(cliHours(72), "3 days");
});

test("closed without a word is neither a reply nor left open", () => {
  const r = buildReplay({ ...EXAMPLE_REPORT, stats: { ...EXAMPLE_REPORT.stats, outsider_attempts: 171, outsider_merged: 5, no_reply: 0, closed_silently: 99 } });
  const text = r.terminal.map(plainLine);
  assert.ok(text.includes("Of the 72 that got a reply, half heard back within 2.3 hours."));
  assert.ok(text.includes("99 were closed without a reply, which isn't counted as ignored."));
});
