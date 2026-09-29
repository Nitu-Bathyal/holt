import assert from "node:assert/strict";
import { test } from "node:test";
import { findTabs } from "./find-tabs.ts";

test("find a project has a tab per page, Hacktoberfest only in season or on its page", () => {
  const ids = (season: boolean, current: "find" | "hacktoberfest" = "find") => findTabs({ signedIn: true, season, current }).map((t) => t.id);
  assert.deepEqual(ids(false), ["find", "browse"]);
  assert.deepEqual(ids(true), ["find", "browse", "hacktoberfest"]);
  assert.deepEqual(ids(false, "hacktoberfest"), ["find", "browse", "hacktoberfest"]);
  assert.deepEqual(findTabs({ signedIn: true, season: true, current: "find" }).map((t) => t.href), ["/find", "/discover", "/hacktoberfest"]);
});

test("signed out, the search tab isn't 'for you'", () => {
  assert.equal(findTabs({ signedIn: true, season: false, current: "find" })[0].label, "for you");
  assert.notEqual(findTabs({ signedIn: false, season: false, current: "find" })[0].label, "for you");
});
