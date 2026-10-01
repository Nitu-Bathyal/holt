// PR watch (API.md, "PR watch (alerts)"): what the bell, My PRs and the alert
// settings show for each access state, and the rules around the unsubscribe
// link. The alert lines themselves come from the server (`AlertItem.text`).
// Pure, so it runs under `node --test`.
import { inFlight, waitPhrase, type Waiting } from "./home.ts";
import { CONNECT_GITHUB } from "./settings.ts";
import type { AlertAccess, AlertItem, AlertSettingsBody, ContributionPR } from "./types";

export type AlertKind = AlertItem["kind"];
export type EmailMode = NonNullable<AlertSettingsBody["email_mode"]>;

/** The bell and the settings tell each other what changed with this window event. */
export const ALERTS_EVENT = "holt:alerts";

/** How often the top bar asks for the unread count. Holt checks GitHub every 30 minutes. */
export const COUNT_EVERY_MS = 5 * 60_000;
/** Coming back to the tab asks again, unless it just did. */
export const COUNT_FRESH_MS = 60_000;

/**
 * What a person sees of PR watch:
 * - hidden: it's switched off on this server, so no bell, no tab, no card;
 * - off: never turned on, or turned off in settings: one button turns it on;
 * - on: the 14 days or a pass, with alerts on;
 * - ended: the 14 days are over. Old alerts stay; one quiet link to the plans.
 */
export type AlertView = "hidden" | "off" | "on" | "ended";

export function alertView(access: AlertAccess, enabled: boolean): AlertView {
  switch (access.state) {
    case "unavailable":
      return "hidden";
    case "ended":
      return "ended";
    case "off":
      return "off";
    default:
      return enabled ? "on" : "off";
  }
}

/**
 * Turning alerts on can need something first: GitHub connected (the server
 * answers 404), or a plan once the 14 days are over (402). Where to send the
 * person then; null for anything else, which is "try again".
 */
export function turnOnDetour(status: number): string | null {
  if (status === 404) return CONNECT_GITHUB;
  return status === 402 ? "/pricing" : null;
}

/** The count on the bell: nothing at zero, "9+" past nine. */
export function badge(unread: number): string {
  if (!(unread > 0)) return "";
  return unread > 9 ? "9+" : String(Math.floor(unread));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Oct", in `tz` (an IANA name) or the reader's own zone. The same words in every browser and on the server. */
export function dayMonth(iso: string | null | undefined, tz?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const parts = (timeZone?: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone }).formatToParts(t);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = parts(tz);
  } catch {
    p = parts(); // a zone this browser doesn't know
  }
  const n = (type: string) => Number(p.find((x) => x.type === type)?.value);
  return `${n("day")} ${MONTHS[n("month") - 1]}`;
}

/** Beside the settings heading: "until 14 Oct", "ended 14 Oct", or nothing. */
export function accessNote(access: AlertAccess, tz?: string): string | null {
  const day = dayMonth(access.until, tz);
  if (!day) return null;
  if (access.state === "trial" || access.state === "pro") return `until ${day}`;
  return access.state === "ended" ? `ended ${day}` : null;
}

/** "Watching 3 PRs · until 14 Oct", under the bell's list. */
export function watchingLine(watching: number, access: AlertAccess, tz?: string): string {
  const until = accessNote(access, tz);
  return `Watching ${watching} PR${watching === 1 ? "" : "s"}${until ? ` · ${until}` : ""}`;
}

/** An alert's two links, never off-site: the pull request on GitHub, and Holt's report on the repo. */
export function alertLinks(a: Pick<AlertItem, "repo" | "number" | "pr_url" | "report_path">): { pr: string; report: string } {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(a.repo) ? a.repo : "";
  return {
    pr: a.pr_url.startsWith("https://github.com/") ? a.pr_url : `https://github.com/${repo}/pull/${a.number}`,
    report: a.report_path.startsWith("/") && !/^\/[/\\]/.test(a.report_path) ? a.report_path : `/${repo}`,
  };
}

/** The colour of an alert's rule: the same as the My PRs group it belongs to. */
export const ALERT_RULE: Record<AlertKind, string> = {
  changes: "var(--orange)",
  reply: "var(--orange)",
  approved: "var(--green)",
  late_reply: "var(--blue)",
  late_merge: "var(--blue)",
  stale_soon: "var(--orange)",
  merged: "var(--green)",
  closed: "var(--line-strong)",
};

export const EMAIL_MODES: { value: EmailMode; label: string }[] = [
  { value: "turn", label: "Your turn right away, the rest at 8:00" },
  { value: "daily", label: "Only the daily email" },
  { value: "all", label: "Everything as it happens" },
];

// --- the time zone -----------------------------------------------------------------

/** The browser's IANA time zone ("Asia/Kolkata"), for the 8:00 email. Undefined when it won't say. */
export function browserTz(intl: Pick<typeof Intl, "DateTimeFormat"> = Intl): string | undefined {
  try {
    const tz = intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTz(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

function isTz(v: unknown): v is string {
  return typeof v === "string" && v.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(v);
}

/** A settings change from the browser, with its time zone (`browserTz()`): every save carries it. */
export function withTz<T extends object>(change: T, tz: string | undefined): T & { tz?: string } {
  return tz ? { ...change, tz } : change;
}

/**
 * The body /api/alerts/settings sends on to the server. Only the switches, the
 * mode and the time zone come from the browser. The address never does: it is
 * the signed-in account's own (`accountEmail`, from the sign-in provider), and
 * it goes along whenever alerts or email are switched on.
 */
export function settingsBody(input: unknown, accountEmail: string | null | undefined): AlertSettingsBody | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const i = input as Record<string, unknown>;
  const body: AlertSettingsBody = {};
  if (typeof i.enabled === "boolean") body.enabled = i.enabled;
  if (typeof i.email_on === "boolean") body.email_on = i.email_on;
  if (EMAIL_MODES.some((m) => m.value === i.email_mode)) body.email_mode = i.email_mode as EmailMode;
  if (isTz(i.tz)) body.tz = i.tz;
  if (!Object.keys(body).length) return null;
  const email = accountEmail?.trim();
  if (email && (body.enabled || body.email_on)) body.email = email;
  return body;
}

// --- the unsubscribe link ----------------------------------------------------------

/** The token from an email's unsubscribe link, or null when it can't be one. */
export function unsubscribeToken(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9._~-]{16,200}$/.test(raw) ? raw : null;
}

/**
 * What a request to /api/alerts/unsubscribe does. Mail scanners and link
 * previews fetch every link in an email, so reading the address never turns
 * anything off: only a POST does (the page's own, or a mail client's
 * one-click). Anything else is sent to the page.
 */
export function unsubscribeStep(method: string, token: string | null): "unsubscribe" | "page" | "bad" {
  if (method.toUpperCase() !== "POST") return "page";
  return token ? "unsubscribe" : "bad";
}

/** The unsubscribe page, from "nothing sent yet" to "undone". */
export type UnsubState = "idle" | "working" | "off" | "on" | "expired" | "failed";

/** Where the page lands after the server answers: 404 is a link that isn't current any more. */
export function unsubAfter(on: boolean, status: number): UnsubState {
  if (status >= 200 && status < 300) return on ? "on" : "off";
  return status === 404 || status === 400 ? "expired" : "failed";
}

// --- the first time ----------------------------------------------------------------

export interface SampleAlert {
  kind: AlertKind;
  text: string;
}

/** The server's words for one open pull request today (API.md's table), or null when nothing would fire. */
function sample(w: Waiting, now: number): SampleAlert | null {
  const p = w.pr;
  const pr = `${p.repo.split("/")[1]} #${p.number}`;
  const who = p.reply_by ? `@${p.reply_by}` : "a reviewer";
  if (p.reply_kind === "changes") return { kind: "changes", text: `Your turn: ${who} asked for changes on ${pr}.` };
  if (p.reply_kind === "reply") return { kind: "reply", text: `Your turn: ${who} replied on ${pr}.` };
  if (p.reply_kind === "approved") return { kind: "approved", text: `Approved: ${who} approved ${pr}.` };
  if (!w.late || p.draft) return null;
  const close = p.verdict?.timing?.stale_close_days;
  if (w.mark == null) {
    if (!close || !p.last_activity_at) return null;
    const quiet = Math.floor(Math.max(0, now - Date.parse(p.last_activity_at)) / 86_400_000);
    return { kind: "stale_soon", text: `Quiet for ${quiet} day${quiet === 1 ? "" : "s"} on ${pr}. The bot here closes at ${close}.` };
  }
  const day = `Day ${Math.floor(w.hours / 24) + 1}`;
  return p.first_reply_at
    ? { kind: "late_merge", text: `${day} on ${pr}. Most merged ones land within ${waitPhrase(w.mark)} here.` }
    : { kind: "late_reply", text: `${day}, no reply on ${pr}. Most get one within ${waitPhrase(w.mark)} here.` };
}

/** Up to two alerts this person's own open pull requests would get today, for the "turn on alerts" card. */
export function sampleAlerts(pulls: ContributionPR[], now: number, max = 2): SampleAlert[] {
  const out: SampleAlert[] = [];
  for (const w of inFlight(pulls.filter((p) => p.counted), now)) {
    const s = sample(w, now);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** My PRs offers alerts once: never turned on, something open to watch, and not dismissed. */
export function showFirstTime(s: { access: AlertAccess; pulls: ContributionPR[]; dismissed: string[] }): boolean {
  return s.access.state === "off" && !s.dismissed.includes("alerts") && s.pulls.some((p) => p.counted && p.state === "open");
}
