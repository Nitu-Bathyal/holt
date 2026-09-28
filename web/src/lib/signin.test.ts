import assert from "node:assert/strict";
import { test } from "node:test";
import { signInNotice } from "./signin.ts";

test("no error, no notice", () => {
  assert.equal(signInNotice(undefined), null);
  assert.equal(signInNotice(null), null);
  assert.equal(signInNotice(""), null);
  assert.equal(signInNotice([]), null);
});

test("the codes Auth.js sends to the sign-in page each get their own plain message", () => {
  assert.match(signInNotice("OAuthAccountNotLinked")!.title, /already has a Holt account/);
  assert.equal(signInNotice("AccountNotLinked"), signInNotice("OAuthAccountNotLinked"));
  assert.match(signInNotice("AccessDenied")!.title, /cancelled/);
  assert.match(signInNotice("OAuthCallbackError")!.title, /didn't finish/);
  assert.match(signInNotice("MissingCSRF")!.body ?? "", /Reload/);
  assert.match(signInNotice("Verification")!.title, /expired/);
  assert.match(signInNotice("Configuration")!.body ?? "", /not something you did/);
});

test("old Auth.js v4 names still read well", () => {
  for (const code of ["OAuthSignin", "OAuthCallback", "OAuthCreateAccount", "Callback"]) {
    assert.equal(signInNotice(code), signInNotice("OAuthCallbackError"), code);
  }
});

test("being sent here to sign in is a nudge, not an error", () => {
  assert.equal(signInNotice("SessionRequired")!.tone, "info");
  assert.equal(signInNotice("SessionRequired")!.body, undefined, "the title says it all");
  assert.equal(signInNotice("AccessDenied")!.tone, "error");
});

test("unknown or odd values get the general message, never the raw code", () => {
  for (const code of ["Nope", "toString", "__proto__", "<script>"]) {
    const n = signInNotice(code)!;
    assert.equal(n.title, "Sign-in didn't work", code);
    assert.ok(!n.body?.includes(code));
  }
  assert.equal(signInNotice(["AccessDenied", "Configuration"])!.title, "Sign-in was cancelled");
});

test("messages are plain English: no internal codes leak into the text", () => {
  for (const code of ["OAuthAccountNotLinked", "OAuthCallbackError", "MissingCSRF", "Configuration", "Verification"]) {
    const n = signInNotice(code)!;
    assert.doesNotMatch(`${n.title} ${n.body}`, /OAuth|CSRF|Callback|Configuration|Adapter/);
  }
});
