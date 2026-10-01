import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import {
  accessNote, alertLinks, alertView, badge, browserTz, dayMonth, EMAIL_MODES, sampleAlerts, settingsBody, showFirstTime, turnOnDetour, unsubAfter,
  unsubscribeStep, unsubscribeToken, watchingLine, withTz,
} from "./alerts.ts";
import type { Timing } from "./api-schema";
import type { AlertAccess, ContributionPR } from "./types";

const access = (state: AlertAccess["state"], until: string | null = null): AlertAccess => ({ state, until });
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const TIMING = { first_reply_half_hours: 10, first_reply_slow_hours: 96, merge_half_days: 6, merge_slow_days: 14, stale_close_days: null } as unknown as Timing;

function pr(over: Partial<ContributionPR> = {}): ContributionPR {
  return {
    repo: "pallets/click", number: 2811, title: "Fix shell completion", url: "https://github.com/pallets/click/pull/2811", state: "open", draft: false,
    created_at: ago(2), closed_at: null, merged_at: null,
    verdict: { verdict: "viable", headline: "Worth your time", tone: "good", checked_at: ago(1), first_reply_hours: 15, timing: TIMING },
    found_via_holt: false, counted: true, not_counted_because: null, turn: "theirs", turn_at: null, first_reply_at: null, last_activity_at: ago(2),
    review_decision: null, reply_by: null, reply_kind: null, watch: null, unread_alert: false, ...over,
  } as ContributionPR;
}

// --- the access states ---------------------------------------------------------------

test("switched off on the server, PR watch is hidden whatever the person's own switch says", () => {
  assert.equal(alertView(access("unavailable"), false), "hidden");
  assert.equal(alertView(access("unavailable"), true), "hidden");
});

test("never turned on: the offer to turn it on", () => {
  assert.equal(alertView(access("off"), false), "off");
  assert.equal(alertView(access("off"), true), "off");
});

test("the 14 days and a pass both show alerts, unless the person turned them off", () => {
  assert.equal(alertView(access("trial", "2026-10-14T10:00:00Z"), true), "on");
  assert.equal(alertView(access("pro"), true), "on");
  assert.equal(alertView(access("trial", "2026-10-14T10:00:00Z"), false), "off");
  assert.equal(alertView(access("pro"), false), "off");
});

test("after the 14 days it has ended, and no switch brings it back", () => {
  assert.equal(alertView(access("ended", "2026-09-20T10:00:00Z"), true), "ended");
  assert.equal(alertView(access("ended", "2026-09-20T10:00:00Z"), false), "ended");
});

test("the note beside the heading: until, ended, or nothing", () => {
  assert.equal(accessNote(access("trial", "2026-10-14T10:00:00Z"), "UTC"), "until 14 Oct");
  assert.equal(accessNote(access("pro", "2027-01-02T10:00:00Z"), "UTC"), "until 2 Jan");
  assert.equal(accessNote(access("pro"), "UTC"), null); // a plan with no expiry
  assert.equal(accessNote(access("ended", "2026-09-20T10:00:00Z"), "UTC"), "ended 20 Sep");
  assert.equal(accessNote(access("off"), "UTC"), null);
  assert.equal(accessNote(access("unavailable"), "UTC"), null);
});

test("the day is the reader's: the same moment is the 15th in Kolkata", () => {
  assert.equal(dayMonth("2026-10-14T20:00:00Z", "UTC"), "14 Oct");
  assert.equal(dayMonth("2026-10-14T20:00:00Z", "Asia/Kolkata"), "15 Oct");
  assert.equal(dayMonth("2026-10-14T20:00:00Z", "Not/AZone"), dayMonth("2026-10-14T20:00:00Z"));
  assert.equal(dayMonth(null), "");
  assert.equal(dayMonth("nope"), "");
});

test("under the bell's list: how many are watched, and until when", () => {
  assert.equal(watchingLine(3, access("trial", "2026-10-14T10:00:00Z"), "UTC"), "Watching 3 PRs · until 14 Oct");
  assert.equal(watchingLine(1, access("pro"), "UTC"), "Watching 1 PR");
  assert.equal(watchingLine(0, access("pro"), "UTC"), "Watching 0 PRs");
});

test("the count on the bell: nothing at zero, 9+ past nine", () => {
  assert.equal(badge(0), "");
  assert.equal(badge(-1), "");
  assert.equal(badge(Number.NaN), "");
  assert.equal(badge(1), "1");
  assert.equal(badge(9), "9");
  assert.equal(badge(10), "9+");
});

test("turning alerts on: connect GitHub first, or the plans once the 14 days are over", () => {
  assert.equal(turnOnDetour(404), "/settings/accounts#github");
  assert.equal(turnOnDetour(402), "/pricing");
  assert.equal(turnOnDetour(501), null);
  assert.equal(turnOnDetour(0), null);
});

test("an alert's links stay on GitHub and on Holt", () => {
  const a = { repo: "pallets/click", number: 2811, pr_url: "https://github.com/pallets/click/pull/2811", report_path: "/pallets/click" };
  assert.deepEqual(alertLinks(a), { pr: a.pr_url, report: "/pallets/click" });
  assert.deepEqual(alertLinks({ ...a, pr_url: "https://evil.example/x", report_path: "//evil.example" }), { pr: a.pr_url, report: "/pallets/click" });
  assert.equal(alertLinks({ ...a, report_path: "/\\evil.example" }).report, "/pallets/click");
  assert.equal(alertLinks({ ...a, pr_url: "javascript:alert(1)" }).pr, a.pr_url);
});

// --- the time zone -------------------------------------------------------------------

const intl = (timeZone: unknown) => ({ DateTimeFormat: (() => ({ resolvedOptions: () => ({ timeZone }) })) as unknown as typeof Intl.DateTimeFormat });

test("the time zone comes from the browser, as an IANA name", () => {
  assert.equal(browserTz(intl("Asia/Kolkata")), "Asia/Kolkata");
  assert.equal(browserTz(intl("America/Argentina/Buenos_Aires")), "America/Argentina/Buenos_Aires");
  assert.equal(browserTz(intl("Etc/GMT+5")), "Etc/GMT+5");
  assert.equal(typeof browserTz(), "string"); // this machine's
});

test("a browser that won't say sends no time zone", () => {
  assert.equal(browserTz(intl(undefined)), undefined);
  assert.equal(browserTz(intl("")), undefined);
  assert.equal(browserTz(intl("x".repeat(65))), undefined);
  assert.equal(browserTz(intl("Asia/Kolkata\n")), undefined);
  assert.equal(browserTz({ DateTimeFormat: (() => { throw new Error("no Intl"); }) as unknown as typeof Intl.DateTimeFormat }), undefined);
});

test("every settings change carries the time zone", () => {
  assert.deepEqual(withTz({ enabled: true }, "Asia/Kolkata"), { enabled: true, tz: "Asia/Kolkata" });
  assert.deepEqual(withTz({ email_mode: "daily" }, "Europe/Berlin"), { email_mode: "daily", tz: "Europe/Berlin" });
  assert.deepEqual(withTz({}, "Asia/Kolkata"), { tz: "Asia/Kolkata" });
  assert.deepEqual(withTz({ email_on: false }, undefined), { email_on: false });
});

test("the time zone reaches the server; a made-up one doesn't", () => {
  assert.deepEqual(settingsBody({ email_mode: "all", tz: "Asia/Kolkata" }, "a@example.com"), { email_mode: "all", tz: "Asia/Kolkata" });
  assert.deepEqual(settingsBody({ tz: "Asia/Kolkata" }, null), { tz: "Asia/Kolkata" });
  assert.deepEqual(settingsBody({ email_on: false, tz: "<script>" }, null), { email_on: false });
  assert.deepEqual(settingsBody({ email_on: false, tz: 5 }, null), { email_on: false });
});

// --- the address ---------------------------------------------------------------------

test("the address is the account's own, never one the browser sent", () => {
  assert.deepEqual(settingsBody({ enabled: true, email: "someone-else@example.com" }, "me@example.com"), { enabled: true, email: "me@example.com" });
  assert.deepEqual(settingsBody({ email_on: true }, " me@example.com "), { email_on: true, email: "me@example.com" });
  // Nothing is being switched on: the address stays as it is.
  assert.deepEqual(settingsBody({ email_mode: "daily", email: "x@example.com" }, "me@example.com"), { email_mode: "daily" });
  assert.deepEqual(settingsBody({ enabled: false }, "me@example.com"), { enabled: false });
  // An account with no address gets the bell only.
  assert.deepEqual(settingsBody({ enabled: true }, null), { enabled: true });
  assert.equal(settingsBody({ email: "x@example.com" }, "me@example.com"), null);
});

test("a settings change is only the switches, the mode and the time zone", () => {
  assert.equal(settingsBody(null, "me@example.com"), null);
  assert.equal(settingsBody("enabled", "me@example.com"), null);
  assert.equal(settingsBody([], "me@example.com"), null);
  assert.equal(settingsBody({}, "me@example.com"), null);
  assert.equal(settingsBody({ enabled: "yes", email_mode: "hourly" }, "me@example.com"), null);
  assert.deepEqual(EMAIL_MODES.map((m) => m.value), ["turn", "daily", "all"]);
  assert.equal(EMAIL_MODES[0].label, "Your turn right away, the rest at 8:00");
});

// --- the unsubscribe link ------------------------------------------------------------

const TOKEN = "u1.3fJ9xK2mQ7vT_aB-cD~eF";

test("a token from an email, or nothing", () => {
  assert.equal(unsubscribeToken(TOKEN), TOKEN);
  assert.equal(unsubscribeToken("short"), null);
  assert.equal(unsubscribeToken("x".repeat(201)), null);
  assert.equal(unsubscribeToken(`${TOKEN}/../x`), null);
  assert.equal(unsubscribeToken(`${TOKEN} `), null);
  assert.equal(unsubscribeToken([TOKEN, TOKEN]), null);
  assert.equal(unsubscribeToken(undefined), null);
});

test("only a POST unsubscribes: a scanner fetching the link changes nothing", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "get"]) assert.equal(unsubscribeStep(method, TOKEN), "page", method);
  assert.equal(unsubscribeStep("POST", TOKEN), "unsubscribe");
  assert.equal(unsubscribeStep("POST", null), "bad");
});

test("the unsubscribe page after the server answers", () => {
  assert.equal(unsubAfter(false, 200), "off");
  assert.equal(unsubAfter(true, 200), "on");
  assert.equal(unsubAfter(false, 404), "expired");
  assert.equal(unsubAfter(false, 400), "expired");
  assert.equal(unsubAfter(false, 502), "failed");
  assert.equal(unsubAfter(true, 0), "failed"); // offline
});

// The rule in API.md: the page sends the token from the browser, never while
// the server renders it. So nothing a page or a component renders may reach
// the server's unsubscribe call: only the POST route handlers do.
const SRC = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SRC), "utf-8");
function files(dir: string): string[] {
  return readdirSync(new URL(dir, SRC)).flatMap((name) => {
    const path = `${dir}${name}`;
    return statSync(new URL(path, SRC)).isDirectory() ? files(`${path}/`) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("the unsubscribe page never talks to the server while it renders", () => {
  const page = read("app/alerts/unsubscribe/page.tsx");
  assert.doesNotMatch(page, /@\/lib\/api["']/, "the page must not import the API client");
  assert.doesNotMatch(page, /alerts-route|fetch\(|"use server"/, "the page must not send anything");
  assert.match(page, /<Unsubscribe token=/);

  const client = read("components/alerts/unsubscribe.tsx");
  assert.match(client, /^"use client";/, "the request is the browser's");
  assert.doesNotMatch(client, /@\/lib\/api["']|alerts-route/);
  // The one request on load is inside an effect, which a server render never runs.
  assert.match(client, /useEffect\(\(\) => \{[^}]*void send\(false\);/);
});

test("only the POST handlers reach the server's unsubscribe call", () => {
  const callers = [...files("app/"), ...files("components/"), ...files("lib/")]
    .filter((f) => !f.endsWith(".test.ts") && !f.startsWith("lib/mock/") && f !== "lib/api.ts")
    .filter((f) => /setAlertEmailByToken|setEmailByToken\(req/.test(read(f)));
  assert.deepEqual(callers.sort(), ["app/api/alerts/resubscribe/route.ts", "app/api/alerts/unsubscribe/route.ts", "lib/alerts-route.ts"]);
  for (const route of ["app/api/alerts/unsubscribe/route.ts", "app/api/alerts/resubscribe/route.ts"]) {
    const src = read(route);
    const exported = [...src.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
    for (const method of exported) {
      const body = src.slice(src.indexOf(`function ${method}`));
      const end = body.indexOf("\n}\n");
      const calls = /setEmailByToken\(/.test(body.slice(0, end));
      assert.equal(calls, method === "POST", `${route}: ${method}`);
    }
  }
});

// --- the first time ------------------------------------------------------------------

test("the card offers alerts once: never turned on, something open, not dismissed", () => {
  const pulls = [pr()];
  assert.equal(showFirstTime({ access: access("off"), pulls, dismissed: [] }), true);
  assert.equal(showFirstTime({ access: access("off"), pulls, dismissed: ["alerts"] }), false);
  assert.equal(showFirstTime({ access: access("off"), pulls: [pr({ state: "merged" })], dismissed: [] }), false);
  assert.equal(showFirstTime({ access: access("off"), pulls: [pr({ counted: false })], dismissed: [] }), false);
  for (const state of ["unavailable", "trial", "pro", "ended"] as const) {
    assert.equal(showFirstTime({ access: access(state), pulls, dismissed: [] }), false, state);
  }
});

test("the card's lines are the alerts this person's pull requests would get today", () => {
  const lines = sampleAlerts(
    [
      pr({ repo: "processing/p5.js", number: 7120, created_at: ago(5.5) }),
      pr({ turn: "yours", turn_at: ago(1), first_reply_at: ago(1), reply_by: "davidism", reply_kind: "changes", review_decision: "changes_requested" }),
    ],
    NOW,
  );
  assert.deepEqual(lines, [
    { kind: "changes", text: "Your turn: @davidism asked for changes on click #2811." },
    { kind: "late_reply", text: "Day 6, no reply on p5.js #7120. Most get one within 4 days here." },
  ]);
});

test("each kind in the server's words", () => {
  const one = (over: Partial<ContributionPR>) => sampleAlerts([pr(over)], NOW)[0]?.text;
  assert.equal(one({ turn: "yours", reply_kind: "reply", reply_by: null }), "Your turn: a reviewer replied on click #2811.");
  assert.equal(one({ reply_kind: "approved", reply_by: "jrios", first_reply_at: ago(1) }), "Approved: @jrios approved click #2811.");
  assert.equal(one({ created_at: ago(19.5), first_reply_at: ago(18) }), "Day 20 on click #2811. Most merged ones land within 2 weeks here.");
  const stale = { ...TIMING, stale_close_days: 30 } as Timing;
  assert.equal(
    one({ created_at: ago(40), first_reply_at: ago(39), last_activity_at: ago(25.2), verdict: { ...pr().verdict!, timing: stale } }),
    "Quiet for 25 days on click #2811. The bot here closes at 30.",
  );
});

test("nothing would fire: no lines, and never more than two", () => {
  assert.deepEqual(sampleAlerts([pr()], NOW), []); // day 3, within the usual wait
  assert.deepEqual(sampleAlerts([pr({ created_at: ago(9), draft: true })], NOW), []);
  assert.deepEqual(sampleAlerts([pr({ created_at: ago(9), counted: false })], NOW), []);
  assert.deepEqual(sampleAlerts([pr({ created_at: ago(9), verdict: null })], NOW), []);
  assert.deepEqual(sampleAlerts([pr({ state: "merged", reply_kind: "approved" })], NOW), []);
  const late = [1, 2, 3].map((n) => pr({ number: n, created_at: ago(9) }));
  assert.equal(sampleAlerts(late, NOW).length, 2);
});
