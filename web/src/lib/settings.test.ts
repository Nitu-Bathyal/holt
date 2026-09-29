import assert from "node:assert/strict";
import { test } from "node:test";
import { RETIRED } from "./shell.ts";
import { connectFailed, CONNECT_GITHUB, legacySettingsHref, SECTIONS } from "./settings.ts";

test("old anchors open their section", () => {
  assert.equal(legacySettingsHref("#profile", ""), "/settings/profile");
  assert.equal(legacySettingsHref("#github", ""), "/settings/accounts");
  assert.equal(legacySettingsHref("#byok", ""), "/settings/ai-reports");
  assert.equal(legacySettingsHref("#stats", ""), "/settings/privacy");
  assert.equal(legacySettingsHref("profile", ""), "/settings/profile");
  assert.equal(legacySettingsHref("#PROFILE", ""), "/settings/profile");
});

test("anchors that still exist inside a section are kept", () => {
  assert.equal(legacySettingsHref("#plan", ""), "/settings/ai-reports#plan");
  assert.equal(legacySettingsHref("#purchases", ""), "/settings/ai-reports#purchases");
});

test("notices in the query string travel along", () => {
  assert.equal(legacySettingsHref("#profile", "?profile=saved"), "/settings/profile?profile=saved");
  assert.equal(legacySettingsHref("#plan", "?subscribed=1"), "/settings/ai-reports?subscribed=1#plan");
  assert.equal(legacySettingsHref("#github", "?github=connected"), "/settings/accounts?github=connected");
});

test("a notice with no anchor still finds its section", () => {
  assert.equal(legacySettingsHref("", "?claimed=1"), "/settings/ai-reports?claimed=1");
  assert.equal(legacySettingsHref("", "?error=early"), "/settings/ai-reports?error=early");
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

test("connecting GitHub happens in Accounts, and /connect lands there", () => {
  assert.equal(RETIRED["/connect"], CONNECT_GITHUB);
  assert.equal(connectFailed("adult"), "/settings/accounts?connect=adult#github");
});
