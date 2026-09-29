import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { anonymousStart, isBot, mintTicket, TICKET_TTL_MS } from "./anon-check.ts";
import { EXAMPLES } from "./examples.ts";
import { checkNeedsSignIn, reportShows, startGate } from "./gate.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const ask = (over: Partial<Parameters<typeof anonymousStart>[0]> = {}) =>
  anonymousStart({
    secret: SECRET,
    ticket: mintTicket(SECRET, "octo/project", 7, NOW),
    ua: CHROME,
    repo: "octo/project",
    mode: "rules",
    days: 7,
    refresh: false,
    now: NOW + 1000,
    ...over,
  });

test("people's browsers aren't bots", () => {
  assert.equal(isBot(CHROME), false);
  assert.equal(isBot(SAFARI_PHONE), false);
});

test("crawlers, link previews, scripts and a missing user agent are bots", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome-Lighthouse",
    "curl/8.5.0",
    "python-requests/2.32.3",
    "Go-http-client/2.0",
    "node",
    "",
    null,
  ]) {
    assert.equal(isBot(ua), true, String(ua));
  }
});

test("signed out, from the report page: a check may start", () => {
  assert.equal(ask(), true);
});

test("a ticket is for one repo (any casing) and one budget", () => {
  assert.equal(ask({ repo: "Octo/Project" }), true);
  assert.equal(ask({ repo: "octo/other" }), false);
  assert.equal(ask({ days: 30 }), false);
});

test("no ticket, a forged one or an old one: no check (the paste box and scripts stay gated)", () => {
  assert.equal(ask({ ticket: undefined }), false);
  assert.equal(ask({ ticket: "" }), false);
  assert.equal(ask({ ticket: "garbage" }), false);
  assert.equal(ask({ ticket: mintTicket("another-secret", "octo/project", 7, NOW) }), false);
  const [exp] = mintTicket(SECRET, "octo/project", 7, NOW).split(".");
  assert.equal(ask({ ticket: `${exp}.AAAA` }), false);
  assert.equal(ask({ now: NOW + TICKET_TTL_MS + 1 }), false);
});

test("a bot never starts a check, even with a ticket", () => {
  assert.equal(ask({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), false);
  assert.equal(ask({ ua: null }), false);
});

test("anonymous checks are the free rules check only: no AI, no forced re-check, and never without a secret", () => {
  assert.equal(ask({ mode: "ai" }), false);
  assert.equal(ask({ refresh: true }), false);
  assert.equal(ask({ secret: undefined }), false);
});

test("the start gate lets an anonymous check through only when the report page allowed it", () => {
  assert.equal(startGate(null, true), null);
  assert.equal(startGate(null, false)?.status, 401);
  assert.equal(startGate(undefined)?.status, 401);
  assert.equal(startGate("user-1", false), null);
});

test("the analyses route checks the ticket for signed-out callers; the paste box never sends one", () => {
  const route = readFileSync(join(import.meta.dirname, "../app/api/analyses/route.ts"), "utf-8");
  assert.match(route, /anonymousStart\(/);
  assert.match(route, /startGate\(who\.userId, /);
  const paste = readFileSync(join(import.meta.dirname, "../components/paste-box.tsx"), "utf-8");
  assert.doesNotMatch(paste, /ticket|api\/analyses/);
});

test("the report page: signed out with nothing cached, a person gets the check and a bot the sign-in teaser", () => {
  const show = (over: Partial<Parameters<typeof reportShows>[0]>) =>
    reportShows({ repo: "octo/project", signedIn: false, found: "missing", anonymousCheck: true, ...over });
  assert.equal(show({}), "check");
  assert.equal(show({ anonymousCheck: false }), "sign-in");
  // A cached report serves without a check: the teaser signed out, in full after sign-in.
  assert.equal(show({ found: "report" }), "teaser");
  assert.equal(show({ found: "report", signedIn: true }), "full");
  // Signed in, as before: a missing report runs the check, an example shows in full.
  assert.equal(show({ signedIn: true, anonymousCheck: false }), "check");
  assert.equal(show({ repo: EXAMPLES[0].repo, found: "report" }), "full");
  assert.equal(show({ found: "error" }), "error");
});

test("over the per-IP limit (or any refusal of a signed-out check): the sign-in teaser, not an error", () => {
  for (const code of ["rate_limited", "unauthorized", "invalid_request"]) assert.equal(checkNeedsSignIn(code), true);
  for (const code of ["not_found", "upstream"]) assert.equal(checkNeedsSignIn(code), false);
});
