import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutTokens } from "./oauth-account.ts";

test("linked accounts keep who they are, not the provider's tokens", () => {
  const account = {
    userId: "u1",
    type: "oauth",
    provider: "github",
    providerAccountId: "12345",
    access_token: "gho_secret",
    refresh_token: "ghr_secret",
    id_token: "eyJ.secret",
    expires_at: 1790000000,
    session_state: "state",
    token_type: "bearer",
    scope: "read:user,user:email",
  };
  const kept = withoutTokens(account);
  assert.deepEqual(kept, {
    userId: "u1",
    type: "oauth",
    provider: "github",
    providerAccountId: "12345",
    token_type: "bearer",
    scope: "read:user,user:email",
  });
  assert.ok(!JSON.stringify(kept).includes("secret"));
  assert.equal(account.access_token, "gho_secret"); // the input is not changed
});
