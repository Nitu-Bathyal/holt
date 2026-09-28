import assert from "node:assert/strict";
import { test } from "node:test";
import { errorHeading } from "./error-heading.ts";

test("a used-up AI budget gets its own heading, not 'switched on yet'", () => {
  const heading = errorHeading({ code: "ai_unavailable", reason: "ai_budget_used_up" });
  assert.equal(heading, "AI is paused for now");
  assert.doesNotMatch(heading, /switched on/);
});

test("AI switched off, and other codes, keep their headings", () => {
  assert.equal(errorHeading({ code: "ai_unavailable" }), "AI reports aren't switched on yet");
  assert.equal(errorHeading({ code: "quota_exceeded" }), "You've used your free AI reports");
  assert.equal(errorHeading({ code: "payments_off" }), "Something went wrong");
});
