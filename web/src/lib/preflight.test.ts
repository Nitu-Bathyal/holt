import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOffer, codeSpans, countsLine, parsePrLink, preflightHref, showPreflight, sizeLine } from "./preflight.ts";
import { EXAMPLE_PREFLIGHT } from "./preflight-example.ts";

const access = (over: Record<string, unknown> = {}) => ({
  feature: "preflight", name: "PR pre-flight check", allowed: true, via: "credits" as const, cost: 1, left_this_month: null, left: null, code: null, message: null, ...over,
});

test("pull request links are recognised, other links aren't", () => {
  assert.deepEqual(parsePrLink("https://github.com/pallets/click/pull/3878"), { repo: "pallets/click", number: 3878 });
  assert.deepEqual(parsePrLink(" github.com/pallets/click/pull/12/files?w=1 "), { repo: "pallets/click", number: 12 });
  assert.deepEqual(parsePrLink("https://githolt.com/o/r/pull/7"), { repo: "o/r", number: 7 });
  assert.deepEqual(parsePrLink("o/r#42"), { repo: "o/r", number: 42 });
  assert.equal(parsePrLink("https://github.com/pallets/click"), null);
  assert.equal(parsePrLink("https://github.com/pallets/click/issues/3"), null);
  assert.equal(parsePrLink("https://gitlab.com/o/r/pull/3"), null);
  assert.equal(parsePrLink("https://github.com/o/r/pull/0"), null);
});

test("the page address names the check", () => {
  assert.equal(preflightHref({ pr: "https://github.com/o/r/pull/1" }), "/preflight?pr=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1");
  assert.equal(preflightHref({ repo: "o/r", branch: "me:fix", base: "" }), "/preflight?repo=o%2Fr&branch=me%3Afix");
  assert.equal(preflightHref({ repo: "o/r" }), "/preflight?repo=o%2Fr");
  assert.equal(preflightHref({}), "/preflight");
});

test("counts read as words, zeros left out, worth fixing first", () => {
  assert.equal(countsLine({ ok: 4, worth_fixing: 2, unknown: 1 }), "2 worth fixing · 1 can't tell yet · 4 look fine");
  assert.equal(countsLine({ ok: 1, worth_fixing: 0, unknown: 0 }), "1 looks fine");
});

test("sizes", () => {
  assert.equal(sizeLine(EXAMPLE_PREFLIGHT.target), "+86 −4 · 3 files");
  assert.equal(sizeLine({ ...EXAMPLE_PREFLIGHT.target, additions: null, deletions: null, files: 1 }), "90 lines · 1 file");
});

test("code spans are split out, nothing else is markup", () => {
  assert.deepEqual(codeSpans("The `lint` check <b>failed</b>"), [["The ", false], ["lint", true], [" check <b>failed</b>", false]]);
});

test("the button only promises what the server allowed", () => {
  assert.deepEqual(checkOffer(null, false), { kind: "sign-in" });
  const credits = checkOffer(access(), false);
  assert.equal(credits.kind, "can-check");
  assert.match((credits as { note: string }).note, /^A check that fails costs nothing/);
  const plan = checkOffer(access({ via: "plan", cost: 0, left_this_month: 4 }), false);
  assert.match((plan as { note: string }).note, /Included in your plan \(4 left this month\)/);
  const soon = checkOffer(access({ allowed: false, via: null, code: "quota_exceeded", message: "no credits" }), false);
  assert.equal(soon.kind, "coming-soon");
  assert.match((soon as { note: string }).note, /aren't on sale yet\.$/);
  const blocked = checkOffer(access({ allowed: false, via: null, code: "quota_exceeded", message: "no credits" }), true);
  assert.deepEqual(blocked, { kind: "blocked", note: "no credits", buy: true });
});

test("the example is internally consistent", () => {
  const c = EXAMPLE_PREFLIGHT.checks;
  assert.deepEqual(EXAMPLE_PREFLIGHT.counts, {
    ok: c.filter((x) => x.verdict === "ok").length,
    worth_fixing: c.filter((x) => x.verdict === "worth_fixing").length,
    unknown: c.filter((x) => x.verdict === "unknown").length,
  });
});

test("pre-flight links stay hidden while it isn't on sale, unless this person can run one", () => {
  assert.equal(showPreflight(null), false);
  assert.equal(showPreflight({ available: false, on_sale: true, access: null }), false);
  assert.equal(showPreflight({ available: true, on_sale: false, access: null }), false);
  assert.equal(showPreflight({ available: true, on_sale: false, access: access({ allowed: false }) }), false);
  assert.equal(showPreflight({ available: true, on_sale: false, access: access() }), true);
  assert.equal(showPreflight({ available: true, on_sale: true, access: null }), true);
});
