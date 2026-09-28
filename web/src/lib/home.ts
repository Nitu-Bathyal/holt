// The signed-in home (/me, docs/design/SIGNED-IN-HOME.md): where sign-in lands,
// who skips the landing page, and what the home suggests next. Fixed rules, no
// model. Pure, so it runs under `node --test`.
import { humanHours } from "./format.ts";
import { safeCallback } from "./safe-url.ts";
import type { ContributionPR, DiscoverRepo } from "./types";

export const HOME = "/me";

/** The escape hatch: a signed-in person can still read the landing page at /?landing=1. */
export const LANDING = "/?landing=1";

/** Where sign-in sends you: back to a safe callbackUrl, else (none, "/" or unsafe) your home. */
export function afterSignIn(callbackUrl: string | string[] | undefined | null): string {
  const to = safeCallback(callbackUrl, HOME);
  return to === "/" ? HOME : to;
}

/** On the redirect from "/": it depends on who's asking, so no cache (Cloudflare included) may keep it. */
export const HOME_REDIRECT_CACHE = "private, no-store";

/** "/" for a signed-in person is their home, unless they asked for the landing page. */
export function landingRedirect(signedIn: boolean, landing: string | string[] | undefined): string | null {
  return signedIn && landing === undefined ? HOME : null;
}

/** The profile card on /me: only while nothing is saved and it hasn't been skipped. */
export function showProfilePrompt(s: { hasProfile: boolean | null; skipped: boolean }): boolean {
  return s.hasProfile === false && !s.skipped;
}

export interface HomeState {
  /** Repos checked while signed in. */
  checked: number;
  /** null when the server couldn't say. */
  hasProfile: boolean | null;
  connected: boolean;
  /** Open pull requests with no decision yet, newest first. */
  waiting: ContributionPR[];
  topPick: { repo: string; reason: string } | null;
}

export interface Step {
  id: "signin" | "check" | "profile" | "github";
  label: string;
  note: string;
  href: string;
  done: boolean;
}

/** Day-one setup. "Sign in" starts ticked, so the list never opens at zero. */
export function setupSteps(s: HomeState): Step[] {
  return [
    { id: "signin", label: "Sign in", note: "Your free AI reports are in your account.", href: HOME, done: true },
    { id: "check", label: "Check a repo you're thinking about", note: "It's kept here, so you can come back to it.", href: "#check", done: s.checked > 0 },
    { id: "profile", label: "Finish your profile", note: "Your languages and the time you have, so Holt can pick repos for you. 30 seconds.", href: "/settings/profile", done: s.hasProfile !== false },
    { id: "github", label: "Connect GitHub (optional)", note: "See your pull requests and whether they were merged.", href: "/connect", done: s.connected },
  ];
}

/** Hide the list once every step is done. */
export function setupLeft(steps: Step[]): number {
  return steps.filter((s) => !s.done).length;
}

export interface NextStep {
  title: string;
  body: string;
  href: string;
  cta: string;
}

/** The one thing worth doing now, in a fixed order. */
export function nextStep(s: HomeState, ago: (iso: string) => string): NextStep {
  if (s.checked === 0) {
    return {
      title: "Check your first repo",
      body: "Paste one you're thinking about. Holt tells you whether outsiders get a reply and get merged.",
      href: "#check",
      cta: "check a repo",
    };
  }
  const pr = s.waiting[0];
  if (pr) {
    return {
      title: `Your pull request to ${pr.repo} is still waiting`,
      body: `Opened ${ago(pr.created_at)}, no decision yet. See how fast this repo usually replies.`,
      href: `/${pr.repo}`,
      cta: "see the repo's report",
    };
  }
  if (s.hasProfile === false) {
    return {
      title: "Finish your profile",
      body: "Your languages and the time you have. Then Holt picks repos where maintainers reply right now.",
      href: "/settings/profile",
      cta: "finish your profile",
    };
  }
  if (s.topPick) {
    return { title: `Try ${s.topPick.repo}`, body: s.topPick.reason, href: `/${s.topPick.repo}`, cta: "read the report" };
  }
  return {
    title: "Find a project",
    body: "Tell Holt what you know. It finds repos worth your time, with issues to start on.",
    href: "/find",
    cta: "find a project",
  };
}

/** Repos whose maintainers answer outsiders fastest, from repos already rated worth your time. */
export function fastestReplies(repos: DiscoverRepo[], limit = 10): DiscoverRepo[] {
  return repos
    .filter((r) => r.verdict === "viable" && r.stats.median_first_response_hours != null)
    .sort((a, b) => a.stats.median_first_response_hours! - b.stats.median_first_response_hours!)
    .slice(0, limit);
}

export function replyLine(hours: number | null | undefined): string | null {
  return hours == null ? null : `Outsiders usually get a reply in ${humanHours(hours)}.`;
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
