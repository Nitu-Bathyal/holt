import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_PLAN, citedLinks, planRecordedOn, share, type PlanSource } from "./merge-plan.ts";

const plan = EXAMPLE_PLAN;
const sources = (): PlanSource[] => [
  ...plan.call.sources,
  ...plan.steps.flatMap((s) => s.sources),
  ...plan.merged.flatMap((f) => f.sources),
  ...plan.reviewers.sources,
];

test("the example never names the AI model", () => {
  const text = JSON.stringify(plan);
  assert.doesNotMatch(text, /"model"/);
  assert.doesNotMatch(text, /gpt|openai|claude|anthropic|gemini|llama|mistral/i);
});

test("every link in the example points at the repo on GitHub", () => {
  const base = `https://github.com/${plan.repo}/`;
  const links = [
    ...citedLinks(plan),
    ...plan.steps.flatMap((s) => (s.link ? [s.link.url] : [])),
    ...plan.closed.flatMap((c) => (c.quote ? [c.quote.url] : [])),
    ...(plan.ai?.quotes.map((q) => q.url) ?? []),
  ];
  for (const url of links) assert.ok(url.startsWith(base), url);
});

test("the example's counts add up", () => {
  const { merged, closed } = plan.sample;
  for (const s of sources()) if (s.seen != null && s.of != null) assert.ok(s.seen <= s.of, s.statement);
  for (const f of plan.merged) assert.ok(f.seen == null || f.of == null || f.seen <= f.of, f.label);
  for (const c of plan.closed) {
    assert.equal(c.of, closed, c.reason);
    assert.equal(c.examples.length, c.seen, c.reason);
    if (c.quote) assert.ok(c.examples.some((e) => e.url === c.quote?.url), `${c.reason}: the quote is one of its pull requests`);
  }
  assert.ok(plan.closed.reduce((n, c) => n + c.seen, 0) <= closed);
  for (const p of plan.reviewers.people) assert.equal(p.of, merged, p.login);
  const ai = plan.ai;
  assert.ok(ai, "the example shows what the AI found");
  assert.equal(ai.threads, merged + closed);
  assert.equal(ai.outcomes.reduce((n, o) => n + o.count, 0), ai.threads);
});

test("the example is a plan: a call, then steps with something to do", () => {
  assert.equal(plan.verdict.headline, "Worth your time");
  assert.ok(plan.call.text.length > 0);
  assert.ok(plan.steps.length >= 3);
  assert.ok(plan.steps.some((s) => s.copy), "one step has a comment to post");
  assert.equal(planRecordedOn(), "30 September 2026");
});

test("share turns a count into a meter width", () => {
  assert.equal(share(8, 25), 32);
  assert.equal(share(30, 25), 100);
  assert.equal(share(null, 25), 0);
  assert.equal(share(3, 0), 0);
});
