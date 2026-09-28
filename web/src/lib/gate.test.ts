import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXAMPLES, isExample } from "./examples.ts";
import { findGate, pasteHref, reportAccess, signInHref, startGate } from "./gate.ts";
import { afterSignIn } from "./home.ts";

const back = (href: string) => new URL(href, "https://holt.test").searchParams.get("callbackUrl");

test("the curated examples cover each verdict and are real repo names", () => {
  assert.ok(EXAMPLES.length >= 3 && EXAMPLES.length <= 5);
  assert.deepEqual(new Set(EXAMPLES.map((e) => e.verdict)), new Set(["viable", "not_viable", "insufficient_evidence"]));
  for (const e of EXAMPLES) assert.match(e.repo, /^[\w.-]+\/[\w.-]+$/);
});

test("an example is recognised whatever the casing", () => {
  const { repo } = EXAMPLES[0];
  assert.ok(isExample(repo));
  assert.ok(isExample(repo.toUpperCase()));
  assert.ok(!isExample("someone/else"));
});

test("signed out: an example report is shown in full, any other repo as a teaser", () => {
  assert.equal(reportAccess(EXAMPLES[0].repo, false), "full");
  assert.equal(reportAccess("octo/project", false), "teaser");
});

test("signed in: every report is shown in full, as before", () => {
  assert.equal(reportAccess("octo/project", true), "full");
  assert.equal(reportAccess(EXAMPLES[0].repo, true), "full");
});

test("sign-in links come back to the page they left", () => {
  const href = signInHref("/octo/project?days=14");
  assert.ok(href.startsWith("/signin?callbackUrl="));
  assert.equal(back(href), "/octo/project?days=14");
});

test("signed out: pasting a repo goes to sign-in, then straight to its report", () => {
  assert.equal(back(pasteHref("octo/project", false)), "/octo/project");
});

test("after sign-in, /signin sends people on to the report or search they asked for", () => {
  assert.equal(afterSignIn(back(pasteHref("octo/project", false))), "/octo/project");
  assert.equal(afterSignIn(back(signInHref("/find?lang=rust&days=7"))), "/find?lang=rust&days=7");
});

test("signed out: pasting an example opens it directly", () => {
  assert.equal(pasteHref(EXAMPLES[0].repo, false), `/${EXAMPLES[0].repo}`);
});

test("signed in: pasting a repo opens its report, as before", () => {
  assert.equal(pasteHref("octo/project", true), "/octo/project");
});

test("signed out: starting a check or a search is refused with a sign-in error", () => {
  for (const gate of [startGate, findGate]) {
    const refused = gate(null);
    assert.ok(refused);
    assert.equal(refused.status, 401);
    assert.equal(refused.error.code, "unauthorized");
    assert.match(refused.error.message, /sign in/i);
  }
});

test("signed in: starting a check or a search goes through", () => {
  assert.equal(startGate("user-1"), null);
  assert.equal(findGate("user-1"), null);
});

test("the extension's public API stays open: it never reads the session or the gate", () => {
  for (const kind of ["report", "starter-issues"]) {
    const src = readFileSync(join(import.meta.dirname, `../app/api/public/${kind}/[owner]/[repo]/route.ts`), "utf-8");
    assert.doesNotMatch(src, /@\/lib\/(session|gate)|@\/auth\b/);
  }
});
