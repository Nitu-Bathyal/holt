// PR watch in the mock (API.md, "PR watch (alerts)"): the 14 days start when
// alerts are turned on, and three alerts about the mock's pull requests are
// there from then. MOCK_PR_WATCH=0 switches it off (the bell is hidden, as in
// production today); MOCK_PR_WATCH=ended shows it after the 14 days.
import "server-only";
import type { AlertAccess, AlertCount, AlertItem, AlertList, AlertSettings, AlertSettingsBody, ApiError, Result, Unsubscribed } from "../types";

const DAY_MS = 86_400_000;
const TRIAL_DAYS = 14;
/** The mock's one unsubscribe link: /alerts/unsubscribe?t=mock-unsubscribe-token */
const TOKEN = "mock-unsubscribe-token";

interface Row {
  enabled: boolean;
  email: string | null;
  emailOn: boolean;
  mode: AlertSettings["email_mode"];
  tz: string;
  trialEnds: number | null;
  read: Set<number>;
  muted: Set<string>;
}

const g = globalThis as unknown as { holtMockAlerts?: Map<string, Row> };
const rows = () => (g.holtMockAlerts ??= new Map());

function row(userId: string): Row {
  let r = rows().get(userId);
  if (!r) {
    r = { enabled: false, email: null, emailOn: true, mode: "turn", tz: "UTC", trialEnds: null, read: new Set([1]), muted: new Set() };
    rows().set(userId, r);
  }
  return r;
}

function err(status: number, code: ApiError["code"], message: string) {
  return { ok: false as const, status, error: { code, message } };
}

function access(r: Row): AlertAccess {
  const flag = process.env.MOCK_PR_WATCH;
  if (flag === "0") return { state: "unavailable", until: null };
  if (flag === "ended") return { state: "ended", until: new Date(Date.now() - 2 * DAY_MS).toISOString() };
  if (r.trialEnds == null) return { state: "off", until: null };
  return { state: r.trialEnds > Date.now() ? "trial" : "ended", until: new Date(r.trialEnds).toISOString() };
}

const live = (r: Row) => access(r).state === "trial";
const prKey = (repo: string, number: number) => `${repo.toLowerCase()}#${number}`;

// About the pull requests in the mock's My Contributions (mock/server.ts).
const ALERTS: Pick<AlertItem, "id" | "kind" | "text" | "repo" | "number" | "title">[] = [
  { id: 3, kind: "changes", text: "Your turn. @davidism asked for changes on click #2811.", repo: "pallets/click", number: 2811, title: "Fix shell completion for nested groups" },
  { id: 2, kind: "late_reply", text: "Day 3 and still no reply on core #153340. Most get one within 2 days here.", repo: "home-assistant/core", number: 153340, title: "Add a battery sensor to the Roborock integration" },
  { id: 1, kind: "merged", text: "nixpkgs #339210 was merged.", repo: "NixOS/nixpkgs", number: 339210, title: "python3Packages.rich: 13.7.1 -> 13.9.4" },
];
const HOURS_AGO: Record<number, number> = { 3: 2, 2: 5, 1: 60 };

function items(r: Row): AlertItem[] {
  if (access(r).state !== "trial" && access(r).state !== "ended") return [];
  return ALERTS.map((a) => {
    const at = new Date(Date.now() - HOURS_AGO[a.id] * 3_600_000).toISOString();
    return { ...a, pr_url: `https://github.com/${a.repo}/pull/${a.number}`, report_path: `/${a.repo}`, created_at: at, read_at: r.read.has(a.id) ? at : null };
  });
}

const unread = (r: Row) => (live(r) ? items(r).filter((a) => !a.read_at).length : 0);
/** The mock's two open pull requests, less the muted ones. */
const watching = (r: Row) => (live(r) && r.enabled ? 2 - [...r.muted].filter((k) => k === prKey("pallets/click", 2811) || k === prKey("home-assistant/core", 153340)).length : 0);

function settings(r: Row): AlertSettings {
  return { enabled: r.enabled, email: r.email, email_on: r.emailOn, email_mode: r.mode, tz: r.tz, access: access(r), watching: watching(r), email_available: false };
}

/** `watch` and `unread_alert` for one row of the mock's My Contributions. */
export function watchFields(userId: string, pr: { repo: string; number: number; state: string; counted: boolean }): { watch: "on" | "muted" | null; unread_alert: boolean } {
  const r = row(userId);
  if (!live(r) || !r.enabled || pr.state !== "open" || !pr.counted) return { watch: null, unread_alert: false };
  const muted = r.muted.has(prKey(pr.repo, pr.number));
  return {
    watch: muted ? "muted" : "on",
    unread_alert: !muted && items(r).some((a) => !a.read_at && prKey(a.repo, a.number) === prKey(pr.repo, pr.number)),
  };
}

export async function alertList(userId: string): Promise<Result<AlertList>> {
  const r = row(userId);
  return { ok: true, data: { unread: unread(r), access: access(r), enabled: r.enabled, watching: watching(r), items: items(r), next_before: null } };
}

export async function alertCount(userId: string): Promise<Result<AlertCount>> {
  return { ok: true, data: { unread: unread(row(userId)) } };
}

export async function readAlerts(userId: string, which: { ids: number[] } | { all: true }): Promise<Result<void>> {
  const r = row(userId);
  for (const id of "all" in which ? ALERTS.map((a) => a.id) : which.ids) r.read.add(id);
  return { ok: true, data: undefined };
}

export async function alertSettings(userId: string): Promise<Result<AlertSettings>> {
  return { ok: true, data: settings(row(userId)) };
}

export async function saveAlertSettings(userId: string, body: AlertSettingsBody, connected: boolean): Promise<Result<AlertSettings>> {
  const r = row(userId);
  if (body.enabled) {
    const state = access(r).state;
    if (state === "unavailable") return err(501, "not_implemented", "Alerts aren't switched on yet.");
    if (!connected) return err(404, "not_found", "Connect your GitHub account to get alerts.");
    if (state === "ended") return err(402, "needs_plan", `Your ${TRIAL_DAYS} days of alerts have ended. Alerts come with Holt Pro.`);
    if (state === "off") r.trialEnds = Date.now() + TRIAL_DAYS * DAY_MS;
  }
  if (body.enabled != null) r.enabled = body.enabled;
  if ("email" in body) r.email = body.email?.trim() || null;
  if (body.email_on != null) r.emailOn = body.email_on;
  if (body.email_mode) r.mode = body.email_mode;
  if (body.tz) r.tz = body.tz;
  return { ok: true, data: settings(r) };
}

export async function setAlertMute(userId: string, repo: string, number: number, muted: boolean): Promise<Result<void>> {
  const r = row(userId);
  if (muted) r.muted.add(prKey(repo, number));
  else r.muted.delete(prKey(repo, number));
  return { ok: true, data: undefined };
}

export async function setAlertEmailByToken(token: string, on: boolean): Promise<Result<Unsubscribed>> {
  if (token !== TOKEN) return err(404, "not_found", "That link doesn't work any more. You can change your alert emails in your settings.");
  for (const r of rows().values()) r.emailOn = on;
  // The answer says which emails the token is for. Not a literal in the return, so it
  // type-checks whether or not the response type has `emails` yet.
  const answer = { email_on: on, emails: "alerts" as const };
  return { ok: true, data: answer };
}
