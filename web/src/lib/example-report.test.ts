import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_REPORT, exampleRecordedOn } from "./example-report.ts";

test("the recorded example is complete", () => {
  const r = EXAMPLE_REPORT;
  assert.equal(r.mode, "ai");
  assert.ok(r.bottom_line && r.summary, "the written explanation is there");
  assert.ok(r.evidence.some((e) => e.quote), "it shows quoted threads");
  for (const e of r.evidence) assert.match(e.url, /^https:\/\/github\.com\//);
});

test("the example reads like plain English", () => {
  const r = EXAMPLE_REPORT;
  const prose = [r.headline, r.verdict_line, r.bottom_line, r.summary, ...r.decided_by, ...r.unknowns, ...r.evidence.map((e) => e.text)].join(" ");
  for (const jargon of ["not_viable", "insufficient_evidence", "repo_kind", "MCC"]) assert.ok(!prose.includes(jargon), jargon);
});

test("the recorded date is the day the evidence was read up to", () => {
  assert.equal(exampleRecordedOn({ ...EXAMPLE_REPORT, evidence_until: "2026-06-01T00:00:00Z" }), "1 June 2026");
});
