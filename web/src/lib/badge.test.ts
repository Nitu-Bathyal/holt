import assert from "node:assert/strict";
import { test } from "node:test";
import { badgeOffered, badgeSnippets, whatWouldChangeIt } from "./badge.ts";

test("only a passing repo is offered a badge", () => {
  assert.equal(badgeOffered({ verdict: "viable" }), true);
  assert.equal(badgeOffered({ verdict: "not_viable" }), false);
  assert.equal(badgeOffered({ verdict: "insufficient_evidence" }), false);
});

test("snippets point at the badge and the report", () => {
  const s = badgeSnippets("https://githolt.com", "pallets/flask");
  assert.equal(s.markdown, "[![Holt](https://githolt.com/badge/pallets/flask.svg)](https://githolt.com/pallets/flask)");
  assert.equal(s.html, '<a href="https://githolt.com/pallets/flask"><img src="https://githolt.com/badge/pallets/flask.svg" alt="Holt"></a>');
});

test("advice follows the rule that decided the verdict", () => {
  assert.deepEqual(whatWouldChangeIt({ verdict: "viable", rule_codes: ["merges"] }), []);
  const ignored = whatWouldChangeIt({ verdict: "not_viable", rule_codes: ["ignored"] });
  assert.match(ignored[0], /Reply to pull requests from newcomers/);
  // The decider is the last rule; earlier ones are context.
  const slow = whatWouldChangeIt({ verdict: "not_viable", rule_codes: ["merges", "slow"] });
  assert.match(slow[0], /first reply/);
  assert.match(whatWouldChangeIt({ verdict: "insufficient_evidence", rule_codes: ["no_attempts"] }).join(" "), /good first issue/);
});

test("unknown or missing rule codes get general advice", () => {
  for (const rule_codes of [[], ["something_new"], undefined]) {
    const out = whatWouldChangeIt({ verdict: "not_viable", rule_codes: rule_codes as string[] });
    assert.ok(out.length > 0 && !out.join(" ").includes("_"));
  }
});
