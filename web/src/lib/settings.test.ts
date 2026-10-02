import assert from "node:assert/strict";
import { test } from "node:test";
import { RETIRED } from "./shell.ts";
import { connectFailed, CONNECT_GITHUB, legacySettingsHref, PLAN_SETTINGS, SECTIONS } from "./settings.ts";

test("old anchors open their section", () => {
  assert.equal(legacySettingsHref("#profile", ""), "/settings/profile");
  assert.equal(legacySettingsHref("#github", ""), "/settings/accounts");
  assert.equal(legacySettingsHref("#byok", ""), "/settings/plan");
  assert.equal(legacySettingsHref("#stats", ""), "/settings/privacy");
  assert.equal(legacySettingsHref("profile", ""), "/settings/profile");
  assert.equal(legacySettingsHref("#PROFILE", ""), "/settings/profile");
});

test("an anchor that still exists inside a section is kept", () => {
  assert.equal(legacySettingsHref("#plan", ""), "/settings/plan");
  assert.equal(legacySettingsHref("#credits", ""), "/settings/plan");
  assert.equal(legacySettingsHref("#purchases", ""), "/settings/plan#purchases");
});

test("notices in the query string travel along", () => {
  assert.equal(legacySettingsHref("#profile", "?profile=saved"), "/settings/profile?profile=saved");
  assert.equal(legacySettingsHref("#purchases", "?subscribed=1"), "/settings/plan?subscribed=1#purchases");
  assert.equal(legacySettingsHref("#github", "?github=connected"), "/settings/accounts?github=connected");
});

test("a notice with no anchor still finds its section", () => {
  assert.equal(legacySettingsHref("", "?subscribed=1"), "/settings/plan?subscribed=1");
  assert.equal(legacySettingsHref("", "?github=connected"), "/settings/accounts?github=connected");
  assert.equal(legacySettingsHref("", "profile=deleted"), "/settings/profile?profile=deleted");
});

test("plain /settings and unknown anchors stay on the overview", () => {
  assert.equal(legacySettingsHref("", ""), null);
  assert.equal(legacySettingsHref("#", ""), null);
  assert.equal(legacySettingsHref("#nope", ""), null);
  assert.equal(legacySettingsHref("#nope", "?utm=x"), null);
});

test("every section lives under /settings", () => {
  for (const s of SECTIONS) assert.equal(s.href, `/settings/${s.id}`);
});

test("the old AI reports section lands on Plan", () => {
  assert.equal(RETIRED["/settings/ai-reports"], PLAN_SETTINGS);
});

test("connecting GitHub happens in Accounts, and /connect lands there", () => {
  assert.equal(RETIRED["/connect"], CONNECT_GITHUB);
  assert.equal(connectFailed("adult"), "/settings/accounts?connect=adult#github");
});
