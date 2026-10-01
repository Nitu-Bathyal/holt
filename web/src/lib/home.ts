// The signed-in home (/me, the signed-in home plan): where sign-in lands,
// and what the home suggests next. Fixed rules, no
// model. Pure, so it runs under `node --test`.
import { humanHours, timeAgo } from "./format.ts";
import { safeCallback } from "./safe-url.ts";
import type { ContributionPR } from "./types";
import { repoNumbers, type YourRepo } from "./your-repos.ts";

export const HOME = "/me";

/** Where sign-in sends you: back to a safe callbackUrl, else (none, "/" or unsafe) your home. */
export function afterSignIn(callbackUrl: string | string[] | undefined | null): string {
  const to = safeCallback(callbackUrl, HOME);
  return to === "/" ? HOME : to;
}

/** At most one nudge, for what's missing, and never the question the page is already asking. */
export type Nudge = "profile" | "github";

export function homeNudge(s: { askingProfile: boolean; hasProfile: boolean | null; connected: boolean; dismissed: string[] }): Nudge | null {
  if (s.hasProfile === false && !s.askingProfile && !s.dismissed.includes("profile")) return "profile";
  if (!s.connected && !s.dismissed.includes("github")) return "github";
  return null;
}

/** The dismissed nudges, from their cookie ("profile,github"). "alerts" is My PRs' "turn on alerts" card (lib/alerts.ts). */
export const NUDGE_COOKIE = "holt_nudges";

export function dismissedNudges(cookie: string | undefined): string[] {
  return (cookie ?? "").split(",").filter((n) => n === "profile" || n === "github" || n === "alerts");
}

/** The line under the heading: "1 PR waiting · 3 AI reports left". Empty when there's nothing to say. */
export function statusLine(s: { waiting: number; credits: { balance: number; ai_available: boolean } | null }): string {
  const parts = [
    s.waiting ? `${s.waiting} PR${s.waiting === 1 ? "" : "s"} waiting for a reply` : null,
    s.credits?.ai_available ? `${s.credits.balance} AI report${s.credits.balance === 1 ? "" : "s"} left` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Pull requests to other people's projects. The server already leaves out the
 * user's own repositories; this is the same rule, in case a login changed.
 * It can't see org membership (the data doesn't carry it).
 */
export function outsidePulls(pulls: ContributionPR[], login: string | null | undefined): ContributionPR[] {
  const me = (login ?? "").toLowerCase();
  return me ? pulls.filter((p) => p.repo.split("/")[0].toLowerCase() !== me) : pulls;
}

// --- the next move (the dashboard plan, "Home") -------------------------------------

const HOUR = 3_600_000;
/** Now, for the home's rules. A function, so a page can read the clock outside render purity rules. */
export function clock(): number {
  return Date.now();
}

/** A merge this recent gets the home's headline. */
export const FRESH_MERGE_HOURS = 72;
/** The stale-bot line shows from this many quiet days before the bot closes (and past half its days). */
export const STALE_WARN_DAYS = 7;

const DAY = 24;

/** A wait in plain words, rounded up so "within" stays true: "6 hours", "a day", "3 days",
 * "2 weeks", "2 months". The same words as the report's "how long it takes here" (schema.wait_phrase). */
export function waitPhrase(hours: number): string {
  const days = hours / DAY;
  if (hours <= 1) return "an hour";
  if (hours < 22) return `${Math.ceil(hours)} hours`;
  if (days <= 1) return "a day";
  if (days <= 13) return `${Math.ceil(days)} days`;
  if (days <= 7 * 8) return `${Math.ceil(days / 7)} weeks`;
  return `${Math.ceil(days / 30)} months`;
}

export interface Waiting {
  pr: ContributionPR;
  /** Since it was opened. */
  hours: number;
  turn: ContributionPR["turn"];
  /** The repo's mark this wait is measured against, in hours, when there is one. */
  mark: number | null;
  /** "Day 9, no reply yet. Most get one within 3 days here." Null when there's nothing to say. */
  line: string | null;
  /** Past the repo's slow mark, or close to its stale bot's. Never when it's your turn. */
  late: boolean;
}

/**
 * Where an open PR stands, against the repo's timing (the report's `stats.timing`):
 * - your turn (the team spoke after you): says so, never late;
 * - quiet close to the repo's stale bot: late;
 * - no reply yet: against the slow first reply (8 in 10 get one by then), late past it;
 * - replied, waiting on the merge: against the half-merged mark, then the slow one, late past it.
 * Nothing when Holt couldn't read the PR, it's a draft, or the repo has no timing.
 */
export function waiting(pr: ContributionPR, now: number): Waiting {
  const hours = Math.max(0, (now - Date.parse(pr.created_at)) / HOUR);
  const turn = pr.turn ?? "unknown";
  const base: Waiting = { pr, hours, turn, mark: null, line: null, late: false };
  if (turn === "yours") {
    const what = pr.review_decision === "changes_requested" ? "a reviewer asked for changes" : "a reviewer replied";
    return { ...base, line: `Your turn: ${what}${pr.turn_at ? ` ${timeAgo(pr.turn_at, now)}` : ""}.` };
  }
  const t = pr.verdict?.timing;
  if (turn === "unknown" || pr.draft || !t) return base;
  const day = `Day ${Math.floor(hours / DAY) + 1}`;
  const close = t.stale_close_days;
  const quiet = pr.last_activity_at ? Math.max(0, (now - Date.parse(pr.last_activity_at)) / HOUR / DAY) : null;
  if (close && quiet != null && quiet >= Math.max(close - STALE_WARN_DAYS, close / 2)) {
    const n = Math.floor(quiet);
    return { ...base, late: true, line: `Quiet for ${n} day${n === 1 ? "" : "s"}. The bot here closes at ${close}.` };
  }
  if (!pr.first_reply_at) {
    const slow = t.first_reply_slow_hours;
    if (slow != null) return { ...base, mark: slow, late: hours > slow, line: `${day}, no reply yet. Most get one within ${waitPhrase(slow)} here.` };
    const half = t.first_reply_half_hours;
    if (half != null) return { ...base, mark: half, line: `${day}, no reply yet. About half get one within ${waitPhrase(half)} here.` };
    return base;
  }
  const half = t.merge_half_days != null ? t.merge_half_days * DAY : null;
  const slow = t.merge_slow_days != null ? t.merge_slow_days * DAY : null;
  if (half != null && (slow == null || hours <= half)) return { ...base, mark: half, line: `${day}. About half are merged within ${waitPhrase(half)} here.` };
  if (slow != null) return { ...base, mark: slow, late: hours > slow, line: `${day}. Most merged ones land within ${waitPhrase(slow)} here.` };
  return base;
}

/** An open PR that needs you: your turn, or waiting longer than the repo usually takes. */
export const needsYou = (w: Waiting) => w.turn === "yours" || w.late;

/**
 * Where you are in the loop (find a repo → pick an issue → open a PR → get it
 * merged) and the one thing to do next. From the account, never ticked by hand.
 */
export type NextMove =
  | { kind: "first"; step: 0; again: boolean }
  | { kind: "issue"; step: 1; repo: string }
  | { kind: "waiting"; step: 3; wait: Waiting }
  | { kind: "merged"; step: 4; pr: ContributionPR; merged: number };

/**
 * `pulls` are the ones that count (outside, not left out). A fresh merge wins,
 * then an open PR (the most overdue first), then a repo worth your time you
 * saved or checked, then finding one.
 */
export function nextMove(s: { pulls: ContributionPR[]; repos: YourRepo[]; now: number }): NextMove {
  const merged = s.pulls.filter((p) => p.state === "merged" && p.merged_at);
  const fresh = merged
    .filter((p) => s.now - Date.parse(p.merged_at!) < FRESH_MERGE_HOURS * HOUR)
    .sort((a, b) => b.merged_at!.localeCompare(a.merged_at!))[0];
  if (fresh) return { kind: "merged", step: 4, pr: fresh, merged: merged.length };
  const open = inFlight(s.pulls, s.now);
  if (open.length) return { kind: "waiting", step: 3, wait: open[0] };
  const worth = s.repos.filter((r) => r.tone === "good");
  const next = worth.find((r) => r.savedAt) ?? worth[0];
  if (next) return { kind: "issue", step: 1, repo: next.repo };
  return { kind: "first", step: 0, again: s.pulls.length > 0 };
}

/** Open PRs: your turn first, then the late ones, then the most overdue (against the repo's mark), then the oldest. */
export function inFlight(pulls: ContributionPR[], now: number): Waiting[] {
  const rank = (w: Waiting) => (w.turn === "yours" ? 2 : w.late ? 1 : 0);
  const ratio = (w: Waiting) => (w.mark ? w.hours / w.mark : 0);
  return pulls
    .filter((p) => p.state === "open")
    .map((p) => waiting(p, now))
    .sort((a, b) => rank(b) - rank(a) || ratio(b) - ratio(a) || b.hours - a.hours);
}

/** The headline, with the words that get the marker in *stars*. */
export function moveTitle(m: NextMove): string {
  switch (m.kind) {
    case "first":
      return m.again ? "Let's find your *next repo.*" : "Let's find your *first repo.*";
    case "issue":
      return `Next: pick an issue in *${m.repo.split("/")[1]}.*`;
    case "merged":
      return `${m.pr.repo} *merged your PR.*`;
    case "waiting": {
      const w = m.wait;
      if (w.turn === "yours") return `It's *your turn* on ${w.pr.repo}.`;
      if (w.late) return `Your PR to ${w.pr.repo} has *waited ${humanHours(w.hours)}.*`;
      return `Your PR to ${w.pr.repo} is *waiting.*`;
    }
  }
}

const ORDINAL = ["", "1st", "2nd", "3rd"];
const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`;

/** One fact under the headline, or null. `repos` lets it say why the next repo
 * is a good one, or why none of yours is yet. */
export function moveLead(m: NextMove, repos: YourRepo[] = []): string | null {
  switch (m.kind) {
    case "merged":
      return `${m.pr.title}. That's your ${ordinal(m.merged)} merged PR this year.`;
    case "waiting":
      return m.wait.line;
    case "issue": {
      const r = repos.find((x) => x.repo.toLowerCase() === m.repo.toLowerCase());
      const n = r?.stats ? repoNumbers(r.stats) : null;
      const why = n && r!.stats!.outsider_attempts ? `: ${n.merged}${n.reply ? `, ${n.reply}` : ""}` : "";
      return `Holt says it's worth your time${why}. Start small with one of its good first issues.`;
    }
    case "first":
      if (repos.length) {
        return `None of the ${repos.length === 1 ? "repo" : `${repos.length} repos`} you saved or checked is worth your time yet. Find one where outside PRs get merged.`;
      }
      if (m.again) return "Your last pull requests are wrapped up. Find a repo where outside PRs get merged and go again.";
      return "Holt reads a repo's recent pull requests and tells you whether outsiders get replies and merges. Start with one where they do.";
  }
}

/** The small numbers under the head: what you've saved, checked and sent. Empty while you're starting. */
export function homeFacts(s: { repos: YourRepo[]; pulls: ContributionPR[] }): string[] {
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const saved = s.repos.filter((r) => r.savedAt).length;
  const checked = s.repos.filter((r) => r.checkedAt).length;
  const open = s.pulls.filter((p) => p.state === "open").length;
  const merged = s.pulls.filter((p) => p.state === "merged").length;
  return [
    saved ? `${saved} saved` : null,
    checked ? `${checked} checked` : null,
    open ? `${count(open, "PR")} open` : null,
    merged ? `${merged} merged this year` : null,
  ].filter((x): x is string => x !== null);
}

/** Also for you: your checks running or just finished, PRs that need you (your
 * turn, or waiting longer than usual; not the headline one), and saved repos that turned. */
export type AlsoItem = { kind: "checking" | "ready"; repo: YourRepo } | { kind: "pr"; wait: Waiting } | { kind: "turned"; repo: YourRepo };

/** A finished check stays in Also for you this long. */
const READY_HOURS = 1;

export function alsoForYou(m: NextMove, s: { pulls: ContributionPR[]; repos: YourRepo[]; now: number }): AlsoItem[] {
  const lead = m.kind === "waiting" ? m.wait.pr.url : null;
  const checks: AlsoItem[] = s.repos
    .filter((r) => r.checking || (r.checkedAt && r.headline && s.now - Date.parse(r.checkedAt) < READY_HOURS * HOUR))
    .map((repo) => ({ kind: repo.checking ? "checking" : "ready", repo }));
  const prs: AlsoItem[] = inFlight(s.pulls, s.now).filter((w) => needsYou(w) && w.pr.url !== lead).map((wait) => ({ kind: "pr", wait }));
  const turned: AlsoItem[] = s.repos.filter((r) => r.savedAt && r.tone === "bad" && !r.checking).map((repo) => ({ kind: "turned", repo }));
  return [...checks.slice(0, 2), ...prs, ...turned].slice(0, 3);
}

/** In flight: open PRs that aren't the headline and aren't already in Also for you. */
export function othersInFlight(m: NextMove, pulls: ContributionPR[], now: number): Waiting[] {
  const lead = m.kind === "waiting" ? m.wait.pr.url : null;
  return inFlight(pulls, now).filter((w) => w.pr.url !== lead && !needsYou(w));
}
