import assert from "node:assert/strict";
import { test } from "node:test";
import { connectErrorFor } from "./github-connect.ts";

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
