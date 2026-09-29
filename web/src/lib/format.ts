import type { Credits, StarterIssue, Stats, Tone } from "./types";

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** 0.8 -> "48 minutes", 30 -> "about a day". */
export function humanHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "unknown";
  const mins = Math.round(hours * 60);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  if (hours < 1.5) return "about an hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = hours / 24;
  if (days < 1.5) return "about a day";
  if (days < 14) return `${Math.round(days)} days`;
  const weeks = days / 7;
  if (weeks < 8) return `${Math.round(weeks)} weeks`;
  return `${Math.round(days / 30)} months`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.round(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

export function shortDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * "N free AI reports left", and what to do when there are none. Credits bought
 * or granted aren't free, so a balance that includes any is just "AI reports".
 */
export function creditsNote(c: Credits): string {
  if (!c.ai_available) return "AI reports aren't switched on yet. Your free ones will be waiting when they are.";
  const kind = c.purchased > 0 ? "AI report" : "free AI report";
  const left = `${c.balance} ${kind}${c.balance === 1 ? "" : "s"} left.`;
  if (c.balance > 0) return `${left} This one uses 1. A failed report doesn't count.`;
  if (c.can_claim) return `${left} Claim 1 more in your settings now.`;
  return `${left} You can claim 1 more${c.next_claim_at ? ` on ${shortDate(c.next_claim_at)}` : " each week"}.`;
}

export function daysLabel(days: number): string {
  if (days <= 1) return "an evening";
  if (days <= 3) return "a weekend";
  if (days <= 7) return "a week";
  if (days <= 14) return "two weeks";
  return "a month";
}

// Tile colours. The server's `odds` (server/holt_server/schema.py, MERGE_*
// and NO_REPLY_*) uses the same thresholds, so a tile and the odds never pull
// different ways.
export function mergeTone(mergedPct: number): Tone {
  return mergedPct >= 12 ? "good" : mergedPct >= 5 ? "warn" : "bad";
}
export function noReplyTone(noReplyPct: number): Tone {
  return noReplyPct <= 25 ? "good" : noReplyPct <= 50 ? "warn" : "bad";
}

export interface StatLine {
  key: string;
  big: string;
  label: string;
  tone: Tone | "neutral";
  /** 0–1 for an optional meter. */
  meter?: number;
}

export function statLines(s: Partial<Stats>): StatLine[] {
  const out: StatLine[] = [];
  if (s.outsider_attempts != null && s.outsider_merged != null) {
    const p = pct(s.outsider_merged, s.outsider_attempts);
    out.push({
      key: "merged",
      big: `${s.outsider_merged} of ${s.outsider_attempts}`,
      label: `outside PRs merged (${p}%)`,
      tone: mergeTone(p),
      meter: s.outsider_attempts ? s.outsider_merged / s.outsider_attempts : 0,
    });
  }
  if (s.median_first_response_hours !== undefined) {
    const h = s.median_first_response_hours;
    out.push({
      key: "reply",
      big: h == null ? "No replies" : humanHours(h),
      label: h == null ? "to measure: no outside PR got an answer" : "is the typical wait for a first reply",
      tone: h == null ? "bad" : h <= 48 ? "good" : h <= 24 * 7 ? "warn" : "bad",
    });
  }
  if (s.first_time_merged_authors != null) {
    out.push({
      key: "first",
      big: String(s.first_time_merged_authors),
      label: s.first_time_merged_authors === 1 ? "person got their first PR merged here" : "people got their first PR merged here",
      tone: s.first_time_merged_authors > 0 ? "good" : "bad",
    });
  }
  if (s.no_reply != null && s.outsider_attempts) {
    const p = pct(s.no_reply, s.outsider_attempts);
    out.push({
      key: "noreply",
      big: `${p}%`,
      label: `of outside PRs never got a reply (${s.no_reply})`,
      tone: noReplyTone(p),
      meter: s.no_reply / s.outsider_attempts,
    });
  }
  if (s.distinct_outsiders != null) {
    out.push({
      key: "people",
      big: String(s.distinct_outsiders),
      label: "different outsiders tried recently",
      tone: "neutral",
    });
  }
  if (s.bot_share != null) {
    const p = Math.round(s.bot_share * 1000) / 10;
    out.push({
      key: "bots",
      big: `${p}%`,
      label: "of PR activity came from bots",
      tone: "neutral",
    });
  }
  return out;
}

const humanize = (k: string) => k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const NEGATIVE = /no_reply|ignored|closed|reject|stale|declin|abandon|negative|hostile/;

// Plain labels for the engine's values. The same table as the engine's
// src/holt/agent/labels.py (tests/test_labels.py holds the two together).
const OUTCOME_LABELS: Record<string, string> = {
  merged_after_review: "Merged after review",
  merged_without_engagement: "Merged without review comments",
  changes_requested: "Changes requested",
  closed_with_guidance: "Closed, with a pointer elsewhere",
  closed_dismissive: "Closed with no way forward",
  ignored: "No reply",
};
const FIELD_LABELS: Record<string, string> = {
  repo_kind: "Kind of project",
  onboarding: "Contributor guide",
  outsider_posture: "How outside contributors are treated",
  governance_flags: "Before you contribute",
  is_archived: "Archived",
  inactive: "Activity",
  personal_project: "Whose project this is",
  contribute_elsewhere: "Where to contribute",
};

/**
 * Label and tone for an evidence item. Rules mode lists newcomer PRs as
 * kind "outsider_pr" (value "merged" | "no_reply"); AI mode uses "outcome"
 * (value like "merged_after_review") or the engine field a claim is about.
 */
export function evidenceLabel(e: { kind: string; value: string | null }): { label: string; bad: boolean } {
  const value = e.value ?? "";
  const bad = NEGATIVE.test(value);
  if (e.kind === "outsider_pr") {
    return { label: e.value === "merged" ? "Newcomer PR merged" : e.value === "no_reply" ? "Newcomer PR, no reply" : `Newcomer PR: ${humanize(value).toLowerCase()}`, bad };
  }
  if (e.kind === "outcome") return { label: OUTCOME_LABELS[value] ?? humanize(value), bad };
  return { label: FIELD_LABELS[e.kind] ?? humanize(e.kind), bad };
}

/** "#526518" or a short id for an evidence link. */
export function evidenceRef(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/[^/]+\/(pull|issues|discussions|commit)\/([^/#?]+)/);
  if (!m) return "open on GitHub";
  return m[1] === "commit" ? m[2].slice(0, 7) : `#${m[2]}`;
}

/** The one-line "what to do next" for a starter issue. */
export function nextStep(issue: StarterIssue): string {
  const labels = issue.labels.map((l) => l.toLowerCase());
  const docs = labels.some((l) => l.includes("doc"));
  if (issue.comments === 0) {
    return docs
      ? "Comment on the issue to say you'd like to fix the docs, then open a small pull request."
      : "Comment on the issue to ask if you can take it.";
  }
  if (issue.comments <= 3) return "Read the comments first, then ask if it's still free for you to take.";
  return "Read the discussion; if nobody is working on it, ask a maintainer if you can pick it up.";
}
