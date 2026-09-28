import assert from "node:assert/strict";
import { test } from "node:test";
import { SAVE_PARAM, signInToSave, wantsSave, withoutSave } from "./saved.ts";

const back = (href: string) => new URL(href, "https://holt.test").searchParams.get("callbackUrl");

test("signing in to save comes back to the same page, asking to save", () => {
  const href = signInToSave("/pallets/flask", "", "pallets/flask");
  assert.ok(href.startsWith("/signin?callbackUrl="));
  assert.equal(back(href), `/pallets/flask?${SAVE_PARAM}=pallets%2Fflask`);
});

test("keeps the page's own query and replaces an old save request", () => {
  const href = signInToSave("/discover", "?sort=stars&save=octo%2Fold", "octo/new");
  const u = new URL(back(href)!, "https://holt.test");
  assert.equal(u.pathname, "/discover");
  assert.equal(u.searchParams.get("sort"), "stars");
  assert.deepEqual(u.searchParams.getAll(SAVE_PARAM), ["octo/new"]);
});

test("a page asks to save only the repo it names, whatever the casing", () => {
  assert.equal(wantsSave("?save=Pallets%2FFlask", "pallets/flask"), true);
  assert.equal(wantsSave("save=pallets/flask&x=1", "pallets/flask"), true);
  assert.equal(wantsSave("?save=octo%2Fother", "pallets/flask"), false);
  assert.equal(wantsSave("", "pallets/flask"), false);
});

test("the request is dropped from the address once handled", () => {
  assert.equal(withoutSave("/pallets/flask", "?save=pallets%2Fflask"), "/pallets/flask");
  assert.equal(withoutSave("/pallets/flask", "?days=3&save=pallets%2Fflask"), "/pallets/flask?days=3");
});
