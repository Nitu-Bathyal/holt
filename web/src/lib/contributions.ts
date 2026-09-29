// Your pull requests: the wording for the summary and the refresh cooldown,
// and the page's groups. Pure, so it can be tested without React.
import { inFlight, type Waiting } from "./home.ts";
import type { ContributionPR, Contributions } from "./types";

export type PullState = ContributionPR["state"];

export const STATE_LABEL: Record<PullState, string> = {
  open: "waiting",
  merged: "merged",
  closed: "closed, not merged",
};

/** "3 of 5 decided got merged", or null when nothing has been decided yet. */
export function landedLine(s: Contributions["summary"]): string | null {
  const decided = s.merged + s.closed;
  if (decided === 0) return null;
  return `${s.merged} of ${decided} decided got merged`;
}

/** The landed share as a whole percentage, or null. */
export function landedPct(s: Contributions["summary"]): number | null {
  return s.landed_share == null ? null : Math.round(s.landed_share * 100);
}

/** Minutes until the refresh button works again (0 = now). */
export function minutesLeft(nextRefreshAt: string | null, now = Date.now()): number {
  if (!nextRefreshAt) return 0;
  const t = Date.parse(nextRefreshAt);
  if (!Number.isFinite(t) || t <= now) return 0;
  return Math.max(1, Math.ceil((t - now) / 60_000));
}

export function cooldownLabel(mins: number): string {
  return mins <= 0 ? "" : `you can refresh again in ${mins} minute${mins === 1 ? "" : "s"}`;
}

/** One sentence under the numbers about PRs opened after checking a repo on Holt. */
export function foundViaHoltLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 of them you opened within 30 days of checking the repo on Holt."
    : `${n} of them you opened within 30 days of checking the repo on Holt.`;
}

// --- Your pull requests, grouped by next move (docs/design/DASHBOARD.md) ------------------

/** A repo left out of your numbers, and why: you chose so, or it's your own or your team's project. */
export interface NotCounted {
  repo: string;
  because: "you" | "own_project";
  pulls: ContributionPR[];
}

export interface PrGroups {
  /** Open and waiting longer than the repo usually takes to reply. */
  needs: Waiting[];
  /** Open, within the usual time (or the repo's usual time isn't known). */
  waiting: Waiting[];
  merged: ContributionPR[];
  closed: ContributionPR[];
  notCounted: NotCounted[];
}

const decidedAt = (p: ContributionPR) => p.merged_at ?? p.closed_at ?? p.created_at;
const newestDecided = (a: ContributionPR, b: ContributionPR) => decidedAt(b).localeCompare(decidedAt(a));

export function prGroups(pulls: ContributionPR[], now: number): PrGroups {
  const counted = pulls.filter((p) => p.counted);
  const open = inFlight(counted, now);
  const out = new Map<string, NotCounted>();
  for (const p of pulls) {
    if (p.counted) continue;
    const k = p.repo.toLowerCase();
    const row = out.get(k) ?? { repo: p.repo, because: p.not_counted_because ?? "you", pulls: [] };
    row.pulls.push(p);
    out.set(k, row);
  }
  return {
    needs: open.filter((w) => w.late),
    waiting: open.filter((w) => !w.late),
    merged: counted.filter((p) => p.state === "merged").sort(newestDecided),
    closed: counted.filter((p) => p.state === "closed").sort(newestDecided),
    notCounted: [...out.values()].sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

/** The page's sentence, from what needs you down to nothing yet. */
export function prsTitle(g: PrGroups): string {
  const n = g.needs.length;
  if (n) return n === 1 ? "1 PR is *waiting longer than usual.*" : `${n} PRs are *waiting longer than usual.*`;
  const w = g.waiting.length;
  if (w) return w === 1 ? "1 PR is *waiting for a reply.*" : `${w} PRs are *waiting for a reply.*`;
  if (g.merged.length) return `${g.merged.length} merged. *Nothing needs you.*`;
  if (g.closed.length) return "Nothing open. *Time for the next one.*";
  return "No pull requests *yet.*";
}
