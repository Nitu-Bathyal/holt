import assert from "node:assert/strict";
import { test } from "node:test";
import { connectErrorFor, mergeProof, readMergeProof, signInMove } from "./github-connect.ts";

test("a GitHub account that belongs to another Holt account comes back as 'taken'", () => {
  assert.equal(connectErrorFor("https://githolt.com/signin?error=OAuthAccountNotLinked"), "taken");
  assert.equal(connectErrorFor("/signin?error=OAuthAccountNotLinked"), "taken");
});

test("any other failed link (cancelled at GitHub, a bad callback, our config) comes back as 'link'", () => {
  for (const code of ["AccessDenied", "OAuthCallbackError", "Configuration", "CallbackRouteError"]) {
    assert.equal(connectErrorFor(`https://githolt.com/signin?error=${code}`), "link", code);
  }
  assert.equal(connectErrorFor("https://githolt.com/api/auth/error?error=Configuration"), "link");
});

test("a link that worked is left alone", () => {
  assert.equal(connectErrorFor("https://githolt.com/api/github/connect"), null);
  assert.equal(connectErrorFor("https://githolt.com/signin?callbackUrl=%2Fme"), null);
  assert.equal(connectErrorFor("https://github.com/login/oauth/authorize?client_id=x"), null);
  assert.equal(connectErrorFor(null), null);
  assert.equal(connectErrorFor(""), null);
});

// --- merging two accounts ---------------------------------------------------------------

const SECRET = "a test secret";
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const proof = (over: Partial<Parameters<typeof mergeProof>[0]> = {}, secret = SECRET, at = NOW) =>
  mergeProof({ githubId: "583231", userId: "kept", optOut: false, ...over }, secret, at);

test("a proof names the GitHub account GitHub just confirmed and the choices from the form", () => {
  assert.deepEqual(readMergeProof(proof(), "kept", SECRET, NOW + 60_000), { githubId: "583231", optOut: false });
  assert.deepEqual(readMergeProof(proof({ optOut: true }), "kept", SECRET, NOW), { githubId: "583231", optOut: true });
});

test("without a proof there is nothing to merge", () => {
  for (const none of [undefined, "", "merge", "583231", "e30.abc", "a.b.c"]) {
    assert.equal(readMergeProof(none, "kept", SECRET, NOW), null, String(none));
  }
});

test("a proof is good for ten minutes", () => {
  assert.ok(readMergeProof(proof(), "kept", SECRET, NOW + 599_000));
  assert.equal(readMergeProof(proof(), "kept", SECRET, NOW + 601_000), null);
});

test("a proof made in someone else's session is refused", () => {
  assert.equal(readMergeProof(proof({ userId: "someone-else" }), "kept", SECRET, NOW), null);
});

test("a proof can't be pointed at another GitHub account", () => {
  const [body, sig] = proof().split(".");
  const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), g: "42" })).toString("base64url");
  assert.equal(readMergeProof(`${other}.${sig}`, "kept", SECRET, NOW), null);
  // Nor can one be made without the server's secret, or with none set.
  assert.equal(readMergeProof(proof({ githubId: "42" }, "a guess"), "kept", SECRET, NOW), null);
  assert.equal(readMergeProof(proof({}, ""), "kept", "", NOW), null);
});

test("the account that signs in with the confirmed GitHub account is the one merged", () => {
  assert.deepEqual(signInMove("583231", "kept", [{ userId: "old", githubId: "583231" }]), { from: "old" });
});

test("a repeated merge finds the sign-in already moved", () => {
  assert.equal(signInMove("583231", "kept", [{ userId: "kept", githubId: "583231" }]), "done");
});

test("no merge when nobody signs in with that GitHub account, or the kept account has another", () => {
  assert.equal(signInMove("583231", "kept", []), "refuse");
  assert.equal(signInMove("583231", "kept", [{ userId: "old", githubId: "583231" }, { userId: "kept", githubId: "42" }]), "refuse");
  assert.equal(signInMove("583231", "kept", [{ userId: "kept", githubId: "42" }]), "refuse");
});
