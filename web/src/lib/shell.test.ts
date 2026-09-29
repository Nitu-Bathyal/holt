import assert from "node:assert/strict";
import { test } from "node:test";
import { activeItem, CHECK_HREF, jumpHref, LANDING_SECTIONS, logoAction, logoHref, RETIRED, retiredRedirect, shellFor, sidebarGroups } from "./shell.ts";

test("signed out, every page wears the marketing shell", () => {
  for (const p of ["/", "/me", "/find", "/pallets/flask", "/settings/profile", "/pricing"]) assert.equal(shellFor(p, false), "marketing", p);
});

test("signed in, the app pages get the sidebar and the pages that explain or sell Holt don't", () => {
  for (const p of ["/me", "/me/saved", "/me/history", "/me/contributions", "/find", "/discover", "/discover/python", "/compare",
    "/pallets/flask", "/settings", "/settings/ai-reports", "/preflight", "/hacktoberfest", "/connect", "/example-ai-report"]) {
    assert.equal(shellFor(p, true), "app", p);
  }
  for (const p of ["/", "/how-it-works", "/pricing", "/pricing/thanks", "/privacy", "/terms", "/refunds", "/contact", "/badge", "/signin", "/pricing/"]) {
    assert.equal(shellFor(p, true), "marketing", p);
  }
  // A repo whose owner happens to start like a marketing page is still a report.
  assert.equal(shellFor("/pricingco/tool", true), "app");
});

test("jump links glide on the landing page and go to it from anywhere else", () => {
  assert.equal(jumpHref("/", "verdicts"), "#verdicts");
  assert.equal(jumpHref("/pricing", "answer"), "/#answer");
  assert.deepEqual(LANDING_SECTIONS.map((s) => s.id), ["answer", "what-it-checks", "verdicts", "open-source"]);
});

test("the sidebar holds five places, each once, with a plain label and an icon", () => {
  const items = sidebarGroups().flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.href), ["/me", "/find", "/me/contributions", "/me/repos", "/compare"]);
  for (const i of items) {
    assert.ok(i.icon, i.id);
    assert.doesNotMatch(i.label, /_|for-you|contributions|history/i, i.label);
  }
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  // Checking a repo is the top bar's box; settings, help and sign-out live in the account menu.
  for (const href of [CHECK_HREF, "/settings/profile", "/how-it-works", "/preflight", "/discover"]) {
    assert.ok(!items.some((i) => i.href === href), href);
  }
});

test("one sidebar item lights up per page, the most specific one", () => {
  const g = sidebarGroups();
  assert.equal(activeItem(g, "/me"), "home");
  assert.equal(activeItem(g, "/me/"), "home");
  assert.equal(activeItem(g, "/me/repos"), "repos");
  assert.equal(activeItem(g, "/me/contributions?refresh=done"), "prs");
  assert.equal(activeItem(g, "/discover/python"), "find");
  assert.equal(activeItem(g, "/hacktoberfest"), "find");
  assert.equal(activeItem(g, "/compare"), "compare");
  // Settings has its own tabs; a report page isn't any of them.
  assert.equal(activeItem(g, "/settings/privacy"), null);
  assert.equal(activeItem(g, "/pallets/flask"), null);
});

test("retired addresses go to where their content lives now", () => {
  assert.equal(RETIRED["/for-you"], "/me#picks");
  assert.equal(retiredRedirect("/for-you"), "/me#picks");
  assert.equal(retiredRedirect("/for-you/"), "/me#picks");
  // Saved and checked are one list now, on the tab you came for.
  assert.equal(retiredRedirect("/me/saved"), "/me/repos?show=saved");
  assert.equal(retiredRedirect("/me/history/"), "/me/repos?show=checked");
  for (const p of ["/", "/me", "/constructor", "/__proto__", "/for-you/x"]) assert.equal(retiredRedirect(p), null, p);
});

test("the logo goes home when signed in, on every page, and to the landing page when not", () => {
  assert.equal(logoHref(true), "/me");
  assert.equal(logoHref(false), "/");
});

test("the logo: signed out on the landing page it glides to the hero; signed in it always goes home", () => {
  assert.deepEqual(logoAction("/", false), { hero: true });
  assert.deepEqual(logoAction("/", true), { href: "/me" });
  assert.deepEqual(logoAction("/pricing", false), { href: "/" });
  assert.deepEqual(logoAction("/pricing", true), { href: "/me" });
  assert.deepEqual(logoAction("/pallets/flask", true), { href: "/me" });
});
