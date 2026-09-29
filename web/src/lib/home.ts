// The signed-in home (/me, docs/design/SIGNED-IN-HOME.md): where sign-in lands,
// and what the home suggests next. Fixed rules, no
// model. Pure, so it runs under `node --test`.
import { humanHours } from "./format.ts";
import { safeCallback } from "./safe-url.ts";
import type { ContributionPR } from "./types";
import type { YourRepo } from "./your-repos.ts";

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

/** The dismissed nudges, from their cookie ("profile,github"). */
export const NUDGE_COOKIE = "holt_nudges";

export function dismissedNudges(cookie: string | undefined): string[] {
  return (cookie ?? "").split(",").filter((n) => n === "profile" || n === "github");
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

// --- the next move (docs/design/DASHBOARD.md, "Home") -------------------------------------

const HOUR = 3_600_000;
/** Now, for the home's rules. A function, so a page can read the clock outside render purity rules. */
export function clock(): number {
  return Date.now();
}

/** A merge this recent gets the home's headline. */
export const FRESH_MERGE_HOURS = 72;
/** Waiting this many times the repo's typical first reply counts as longer than usual. */
export const LATE_FACTOR = 1.5;

export interface Waiting {
  pr: ContributionPR;
  hours: number;
  /** The repo's typical wait for a first reply, when its report knows. */
  typical: number | null;
  late: boolean;
}

export function waiting(pr: ContributionPR, now: number): Waiting {
  const hours = Math.max(0, (now - Date.parse(pr.created_at)) / HOUR);
  const typical = pr.verdict?.first_reply_hours ?? null;
  return { pr, hours, typical, late: typical != null && hours > typical * LATE_FACTOR };
}

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

/** Open PRs, most overdue first (waited against the repo's typical reply), then the oldest. */
export function inFlight(pulls: ContributionPR[], now: number): Waiting[] {
  const ratio = (w: Waiting) => (w.typical ? w.hours / w.typical : 0);
  return pulls
    .filter((p) => p.state === "open")
    .map((p) => waiting(p, now))
    .sort((a, b) => ratio(b) - ratio(a) || b.hours - a.hours);
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
      if (w.typical != null && !w.late) return `Your PR to ${w.pr.repo} is *waiting.*`;
      return `Your PR to ${w.pr.repo} has *waited ${humanHours(w.hours)}.*`;
    }
  }
}

const ORDINAL = ["", "1st", "2nd", "3rd"];
const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`;

/** One fact under the headline, or null. */
export function moveLead(m: NextMove): string | null {
  switch (m.kind) {
    case "merged":
      return `${m.pr.title}. That's your ${ordinal(m.merged)} merged PR this year.`;
    case "waiting": {
      const w = m.wait;
      if (w.typical == null) return null;
      const usual = `Replies there usually come within ${humanHours(w.typical)}.`;
      return w.late ? usual : `It's been ${humanHours(w.hours)}. ${usual}`;
    }
    default:
      return null;
  }
}

/** Also for you: PRs waiting longer than usual (not the headline one), and saved repos that turned. */
export type AlsoItem = { kind: "late"; wait: Waiting } | { kind: "turned"; repo: YourRepo };

export function alsoForYou(m: NextMove, s: { pulls: ContributionPR[]; repos: YourRepo[]; now: number }): AlsoItem[] {
  const lead = m.kind === "waiting" ? m.wait.pr.url : null;
  const late: AlsoItem[] = inFlight(s.pulls, s.now).filter((w) => w.late && w.pr.url !== lead).map((wait) => ({ kind: "late", wait }));
  const turned: AlsoItem[] = s.repos.filter((r) => r.savedAt && r.tone === "bad").map((repo) => ({ kind: "turned", repo }));
  return [...late, ...turned].slice(0, 3);
}

/** In flight: open PRs that aren't the headline and aren't already in Also for you. */
export function othersInFlight(m: NextMove, pulls: ContributionPR[], now: number): Waiting[] {
  const lead = m.kind === "waiting" ? m.wait.pr.url : null;
  return inFlight(pulls, now).filter((w) => w.pr.url !== lead && !w.late);
}
