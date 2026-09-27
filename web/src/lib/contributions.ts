// My Contributions: the wording for the summary and the refresh cooldown.
// Pure, so it can be tested without React.
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
