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

test("the sidebar holds every signed-in page, each once, with a plain label and an icon", () => {
  const groups = sidebarGroups({ hacktoberfest: true, preflight: true });
  assert.deepEqual(groups.map((g) => g.label), [null, "Yours", "Account"]);
  const items = groups.flatMap((g) => g.items);
  assert.deepEqual(items.map((i) => i.href), [
    "/me", CHECK_HREF, "/find", "/discover", "/compare", "/hacktoberfest",
    "/me/contributions", "/me/saved", "/me/history", "/preflight",
    "/settings/profile", "/how-it-works",
  ]);
  for (const i of items) {
    assert.ok(i.icon, i.id);
    assert.doesNotMatch(i.label, /_|for-you|contributions|history/i, i.label);
  }
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  // Settings' own sections sit under it.
  assert.deepEqual(items.find((i) => i.id === "settings")!.children!.map((c) => c.href),
    ["/settings/profile", "/settings/ai-reports", "/settings/accounts", "/settings/privacy"]);
});

test("Hacktoberfest shows only in October, Check your PR only where pre-flight runs", () => {
  const ids = (o: { hacktoberfest: boolean; preflight: boolean }) => sidebarGroups(o).flatMap((g) => g.items).map((i) => i.id);
  assert.ok(!ids({ hacktoberfest: false, preflight: false }).includes("hacktoberfest"));
  assert.ok(!ids({ hacktoberfest: false, preflight: false }).includes("preflight"));
  assert.ok(ids({ hacktoberfest: true, preflight: false }).includes("hacktoberfest"));
  assert.ok(ids({ hacktoberfest: false, preflight: true }).includes("preflight"));
});

test("one sidebar item lights up per page, the most specific one", () => {
  const g = sidebarGroups({ hacktoberfest: true, preflight: true });
  assert.equal(activeItem(g, "/me"), "home");
  assert.equal(activeItem(g, "/me/"), "home");
  assert.equal(activeItem(g, "/me/saved"), "saved");
  assert.equal(activeItem(g, "/me/contributions?refresh=done"), "prs");
  assert.equal(activeItem(g, "/discover/python"), "browse");
  assert.equal(activeItem(g, "/settings"), "settings");
  assert.equal(activeItem(g, "/settings/privacy"), "settings");
  assert.equal(activeItem(g, "/connect"), "settings");
  assert.equal(activeItem(g, "/preflight"), "preflight");
  // A report page isn't any of them. "Check a repo" is an action, never lit.
  assert.equal(activeItem(g, "/pallets/flask"), null);
});

test("retired addresses go to where their content lives now", () => {
  assert.equal(RETIRED["/for-you"], "/me#picks");
  assert.equal(retiredRedirect("/for-you"), "/me#picks");
  assert.equal(retiredRedirect("/for-you/"), "/me#picks");
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
