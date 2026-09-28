// The signed-in home (/me, docs/design/SIGNED-IN-HOME.md): where sign-in lands,
// and what the home suggests next. Fixed rules, no
// model. Pure, so it runs under `node --test`.
import { safeCallback } from "./safe-url.ts";
import type { ContributionPR } from "./types";

export const HOME = "/me";

/** Where sign-in sends you: back to a safe callbackUrl, else (none, "/" or unsafe) your home. */
export function afterSignIn(callbackUrl: string | string[] | undefined | null): string {
  const to = safeCallback(callbackUrl, HOME);
  return to === "/" ? HOME : to;
}

/** New: nothing to come back to yet. Returning: at least one check, saved repo or pull request. */
export type HomeKind = "new" | "returning";

export function homeKind(s: { checked: number; saved: number; pulls: number }): HomeKind {
  return s.checked + s.saved + s.pulls > 0 ? "returning" : "new";
}

/**
 * The page's one primary action. New: the profile questions, until they're
 * answered or skipped, then find a project. Returning: check a repo.
 */
export type Primary = "profile" | "find" | "check";

export function primaryAction(kind: HomeKind, s: { hasProfile: boolean | null; skipped: boolean }): Primary {
  if (kind === "returning") return "check";
  return s.hasProfile === false && !s.skipped ? "profile" : "find";
}

/** At most one nudge, for what's missing, and never the same thing as the primary action. */
export type Nudge = "profile" | "github";

export function homeNudge(s: { primary: Primary; hasProfile: boolean | null; connected: boolean; dismissed: string[] }): Nudge | null {
  if (s.hasProfile === false && s.primary !== "profile" && !s.dismissed.includes("profile")) return "profile";
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

/** One repo's pull requests on the home's row: newest first, with counts by state. */
export interface PullGroup {
  repo: string;
  pulls: ContributionPR[];
  open: number;
  merged: number;
  closed: number;
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

const newest = (a: ContributionPR, b: ContributionPR) => b.created_at.localeCompare(a.created_at);

/** Pull requests by repo, one group each: repos with one still waiting first, then the most recent. */
export function groupPulls(pulls: ContributionPR[]): PullGroup[] {
  const by = new Map<string, ContributionPR[]>();
  for (const p of pulls) {
    const k = p.repo.toLowerCase();
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const groups = [...by.values()].map((ps): PullGroup => {
    const sorted = [...ps].sort(newest);
    const n = (s: ContributionPR["state"]) => ps.filter((p) => p.state === s).length;
    return { repo: sorted[0].repo, pulls: sorted, open: n("open"), merged: n("merged"), closed: n("closed") };
  });
  return groups.sort((a, b) => Number(b.open > 0) - Number(a.open > 0) || newest(a.pulls[0], b.pulls[0]));
}

/** "5 pull requests: 4 merged, 1 waiting". */
export function pullCountLine(g: PullGroup): string {
  const parts = [
    g.merged ? `${g.merged} merged` : null,
    g.open ? `${g.open} waiting` : null,
    g.closed ? `${g.closed} closed, not merged` : null,
  ].filter(Boolean);
  return `${g.pulls.length} pull request${g.pulls.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}
