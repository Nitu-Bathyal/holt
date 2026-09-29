import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXAMPLES, isExample } from "./examples.ts";
import { findGate, pasteHref, pasteTarget, reportAccess, signInHref, startGate } from "./gate.ts";
import { afterSignIn } from "./home.ts";

const back = (href: string) => new URL(href, "https://holt.test").searchParams.get("callbackUrl");

test("the curated examples cover each verdict and are real repo names", () => {
  assert.ok(EXAMPLES.length >= 6 && EXAMPLES.length <= 8);
  for (const v of ["viable", "long_shot", "not_viable", "insufficient_evidence"]) {
    assert.ok(EXAMPLES.filter((e) => e.verdict === v).length >= 2, v);
  }
  assert.equal(new Set(EXAMPLES.map((e) => e.repo.toLowerCase())).size, EXAMPLES.length);
  for (const e of EXAMPLES) {
    assert.match(e.repo, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(e.language && e.stars > 0, e.repo);
    // One short line.
    assert.ok(e.why.length <= 60, e.why);
  }
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

test("a paste box asks whether the repo exists before a sign-in wall, and only then", async () => {
  const asked: string[] = [];
  const says = (answer: boolean) => async (r: string) => (asked.push(r), answer);
  // Signed out, a real repo: sign in first.
  assert.equal(await pasteTarget("octo/real", false, says(true)), "/signin?callbackUrl=%2Focto%2Freal");
  // Signed out, a typo: the report URL, which answers 404 (the not-found page).
  assert.equal(await pasteTarget("octo/typo", false, says(false)), "/octo/typo");
  // The check failing never blocks the way in.
  assert.equal(await pasteTarget("octo/real", false, async () => { throw new Error("offline"); }), "/signin?callbackUrl=%2Focto%2Freal");
  // Signed in, or an example: straight to the report (its 404 is the proxy's), no question asked.
  asked.length = 0;
  assert.equal(await pasteTarget("octo/typo", true, says(false)), "/octo/typo");
  assert.equal(await pasteTarget(EXAMPLES[0].repo, false, says(false)), `/${EXAMPLES[0].repo}`);
  assert.deepEqual(asked, []);
});
