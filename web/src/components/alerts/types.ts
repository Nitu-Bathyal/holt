// PROTOTYPE: the shapes the bell and the PR rows take, and the one line each
// alert says. The real line will be rendered by the server from `kind` and
// `facts`, so the bell, email and extension agree.

/** Whether this person gets alerts: on (a pass or the 14 days), on with none yet, never turned on, or ended. */
export type Access = "on" | "empty" | "off" | "ended";

export type AlertKind =
  | "changes"
  | "reply"
  | "approved"
  | "late_reply"
  | "late_merge"
  | "stale_soon"
  | "stale_marked"
  | "merged"
  | "closed";

export interface AlertItem {
  id: number;
  kind: AlertKind;
  repo: string;
  number: number;
  /** The numbers the line is built from. */
  facts: { who?: string; days?: number; slow?: number | string; quiet?: number; close?: number };
  hoursAgo: number;
  read: boolean;
}

/** The colour of an alert's rule: the same as the My PRs group it belongs to. */
export const ALERT_RULE: Record<AlertKind, string> = {
  changes: "var(--orange)",
  reply: "var(--orange)",
  approved: "var(--green)",
  late_reply: "var(--blue)",
  late_merge: "var(--blue)",
  stale_soon: "var(--orange)",
  stale_marked: "var(--orange)",
  merged: "var(--green)",
  closed: "var(--line-strong)",
};

const days = (n: number | string | undefined) => (typeof n === "number" ? `${n} day${n === 1 ? "" : "s"}` : (n ?? ""));

/** One line, plain English: "Day 6, no reply on p5.js #7120. Most get one within 4 days here." */
export function alertLine(a: Pick<AlertItem, "kind" | "repo" | "number" | "facts">): string {
  const pr = `${a.repo.split("/")[1]} #${a.number}`;
  const f = a.facts;
  switch (a.kind) {
    case "changes":
      return `Your turn: @${f.who} asked for changes on ${pr}.`;
    case "reply":
      return `Your turn: @${f.who} replied on ${pr}.`;
    case "approved":
      return `Approved: @${f.who} approved ${pr}.`;
    case "late_reply":
      return `Day ${f.days}, no reply on ${pr}. Most get one within ${days(f.slow)} here.`;
    case "late_merge":
      return `Day ${f.days} on ${pr}. Most merged ones land within ${days(f.slow)} here.`;
    case "stale_soon":
      return `Quiet for ${f.quiet} days on ${pr}. The bot here closes at ${f.close}.`;
    case "stale_marked":
      return `The bot marked ${pr} as stale.`;
    case "merged":
      return `Merged: ${pr}.`;
    case "closed":
      return `Closed without merging: ${pr}.`;
  }
}

/** "2 hours ago", "yesterday", "3 days ago". */
export function ago(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const d = Math.floor(hours / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
