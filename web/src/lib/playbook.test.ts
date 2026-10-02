import assert from "node:assert/strict";
import { test } from "node:test";
import { codeSpans, isGitHubLink, linkLabel, seenLabel, showPlaybook, unlockOffer } from "./playbook.ts";

const access = { feature: "playbook", name: "Contribution playbook", allowed: true, via: "credits" as const, cost: 1, left_this_month: null, left: null, code: null, message: null };

test("seen in N of M, or nothing for a document", () => {
  assert.equal(seenLabel({ seen: 34, of: 44 }), "seen in 34 of 44 pull requests");
  assert.equal(seenLabel({ seen: 13, of: 25 }, "closed outside pull requests"), "seen in 13 of 25 closed outside pull requests");
  assert.equal(seenLabel({ seen: null, of: null }), null);
});

test("only github.com links are shown", () => {
  assert.equal(isGitHubLink("https://github.com/pallets/flask/pull/1"), true);
  assert.equal(isGitHubLink("http://github.com/pallets/flask/pull/1"), false);
  assert.equal(isGitHubLink("https://github.com.evil.example/x"), false);
  assert.equal(isGitHubLink("javascript:alert(1)"), false);
  assert.equal(isGitHubLink("not a url"), false);
});

test("link labels", () => {
  assert.equal(linkLabel("https://github.com/pallets/flask/pull/3876"), "#3876");
  assert.equal(linkLabel("https://github.com/pallets/flask/issues/12"), "#12");
  assert.equal(linkLabel("https://github.com/pallets/flask/blob/HEAD/docs/contributing.md#L12"), "contributing.md");
});

test("code spans are split out, nothing else is interpreted", () => {
  assert.deepEqual(codeSpans("Pass `main` and `typing`."), [["Pass ", false], ["main", true], [" and ", false], ["typing", true], [".", false]]);
  assert.deepEqual(codeSpans("<b>no html</b>"), [["<b>no html</b>", false]]);
  assert.deepEqual(codeSpans("a lone ` tick"), [["a lone ` tick", false]]);
});

test("the unlock offer follows the server's answer", () => {
  assert.deepEqual(unlockOffer(null, false), { kind: "sign-in" });
  assert.equal(unlockOffer(access, false).kind, "can-unlock");
  assert.match((unlockOffer(access, false) as { note: string }).note, /^A playbook that fails costs nothing\.$/);
  const plan = unlockOffer({ ...access, via: "plan", cost: 0, left_this_month: 9 }, false) as { note: string };
  assert.match(plan.note, /Included in your plan \(9 left this month\)/);
  const refused = { ...access, allowed: false, via: null, code: "quota_exceeded", message: "You don't have enough purchased credits." };
  assert.deepEqual(unlockOffer(refused, false), { kind: "coming-soon", note: "Coming soon: playbooks aren't on sale yet." });
  assert.deepEqual(unlockOffer(refused, true), { kind: "blocked", note: "You don't have enough purchased credits." });
});

test("the playbook stays hidden while it isn't on sale, unless it's already yours", () => {
  const base = { available: true, on_sale: false, access: null, playbook: null, job: null };
  assert.equal(showPlaybook(null), false);
  assert.equal(showPlaybook({ ...base, available: false, on_sale: true }), false);
  assert.equal(showPlaybook(base), false);
  assert.equal(showPlaybook({ ...base, access: { ...access, allowed: false } }), false);
  assert.equal(showPlaybook({ ...base, on_sale: true }), true);
  assert.equal(showPlaybook({ ...base, access }), true);
  assert.equal(showPlaybook({ ...base, job: { job_id: "j", status: "running" } } as never), true);
});
