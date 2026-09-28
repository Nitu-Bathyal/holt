// One shape for a repo in any list (find results, picks, discover boards), so
// they share one compact card, one odds bar and one focus view. Only words and
// numbers the server already sent: nothing here changes a verdict.
// No imports beyond types and format, so it runs under `node --test`.
import { humanHours } from "./format.ts";
import type { DiscoverRepo, FindResult, Odds, Recommendation, StarterIssue, Tone } from "./types.ts";

export interface CardStats {
  /** Decided outside pull requests (the denominator of every rate). */
  attempts: number | null;
  merged: number | null;
  noReply: number | null;
  closedSilently: number | null;
  /** Opened too recently to count. */
  stillOpen: number | null;
  firstTimers: number | null;
  replyHours: number | null;
}

export interface CardRepo {
  repo: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  headline: string;
  tone: Tone;
  stats: CardStats;
  issues: StarterIssue[];
  topics: string[];
  why: string[];
  reason: string | null;
  numbersLine: string | null;
  odds: Odds | null;
  checkedThisWeek: number | null;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function fromFind(r: FindResult): CardRepo {
  const s = r.stats;
  return {
    repo: r.repo, description: r.description, language: r.language, stars: r.stars, headline: r.headline, tone: r.tone,
    stats: { attempts: n(s.outsider_attempts), merged: n(s.outsider_merged), noReply: n(s.no_reply), closedSilently: null, stillOpen: null, firstTimers: n(s.first_time_merged_authors), replyHours: n(s.median_first_response_hours) },
    issues: r.issues, topics: [], why: [], reason: null, numbersLine: null, odds: null, checkedThisWeek: null,
  };
}

function fullStats(s: Recommendation["stats"]): CardStats {
  return { attempts: s.outsider_attempts, merged: s.outsider_merged, noReply: s.no_reply, closedSilently: s.closed_silently, stillOpen: s.still_open, firstTimers: s.first_time_merged_authors, replyHours: n(s.median_first_response_hours) };
}

export function fromPick(p: Recommendation): CardRepo {
  return {
    repo: p.repo, description: p.description, language: p.language, stars: p.stars, headline: p.headline, tone: p.tone,
    stats: fullStats(p.stats), issues: p.issues, topics: p.topics, why: p.why, reason: p.reason, numbersLine: p.numbers_line, odds: p.odds, checkedThisWeek: null,
  };
}

export function fromDiscover(d: DiscoverRepo): CardRepo {
  return {
    repo: d.repo, description: d.description, language: d.language, stars: d.stars, headline: d.headline, tone: d.tone,
    stats: fullStats(d.stats), issues: [], topics: d.topics, why: [], reason: d.reason, numbersLine: null, odds: null, checkedThisWeek: d.checked_this_week,
  };
}

export type SegmentKey = "merged" | "replied" | "other" | "closed" | "silent" | "recent";
export interface Segment {
  key: SegmentKey;
  n: number;
  label: string;
}

const LABEL: Record<SegmentKey, string> = {
  merged: "merged",
  replied: "got a reply but weren't merged",
  other: "weren't merged",
  closed: "closed without a word",
  silent: "got no reply",
  recent: "too recent to count",
};

/**
 * What happened to outside pull requests, as bar segments: merged, replied but
 * not merged, closed without a word, no reply, then the ones too recent to
 * count. Find results don't say which were closed without a word, so there
 * the rest is only "weren't merged". Null when there's nothing to draw.
 */
export function oddsSegments(s: CardStats): Segment[] | null {
  if (!s.attempts || s.merged == null) return null;
  const merged = Math.min(s.merged, s.attempts);
  const closed = Math.min(s.closedSilently ?? 0, s.attempts - merged);
  const silent = Math.min(s.noReply ?? 0, s.attempts - merged - closed);
  const replied = s.attempts - merged - closed - silent;
  const seg = (key: SegmentKey, count: number): Segment => ({ key, n: count, label: LABEL[key] });
  const rest = s.closedSilently == null ? "other" : "replied";
  return [seg("merged", merged), seg(rest, replied), seg("closed", closed), seg("silent", silent), seg("recent", s.stillOpen ?? 0)].filter((x) => x.n > 0);
}

/** The bar in words, for screen readers and the focus view. */
export function oddsText(s: CardStats): string {
  const segs = oddsSegments(s);
  if (!segs) return "No outside pull requests to count yet.";
  const decided = segs.filter((x) => x.key !== "recent");
  const recent = segs.find((x) => x.key === "recent");
  const parts = decided.map((x) => `${x.n} ${x.label}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Of ${s.attempts} outside pull request${s.attempts === 1 ? "" : "s"}, ${list}.${recent ? ` ${recent.n} more ${recent.n === 1 ? "is" : "are"} too recent to count.` : ""}`;
}

/** Up to three short numbers for the card. */
export function statPills(s: CardStats): string[] {
  const out: string[] = [];
  if (s.attempts && s.merged != null) out.push(`${s.merged} of ${s.attempts} merged`);
  if (s.replyHours != null) out.push(`replies in ${humanHours(s.replyHours)}`);
  if (s.firstTimers) out.push(`${s.firstTimers} first-timer${s.firstTimers === 1 ? "" : "s"} merged`);
  return out;
}

// GitHub's own language colours for the ones Holt sees most; the rest get a neutral dot.
const LANG_COLOR: Record<string, string> = {
  python: "#3572A5", javascript: "#f1e05a", typescript: "#3178c6", go: "#00ADD8", rust: "#dea584", java: "#b07219",
  "c++": "#f34b7d", c: "#555555", "c#": "#178600", ruby: "#701516", php: "#4F5D95", nix: "#7e7eff", kotlin: "#A97BFF",
  swift: "#F05138", dart: "#00B4AB", shell: "#89e051", html: "#e34c26", css: "#563d7c", scala: "#c22d40", elixir: "#6e4a7e",
  haskell: "#5e5086", lua: "#000080", r: "#198CE7", julia: "#a270ba", zig: "#ec915c", vue: "#41b883", svelte: "#ff3e00",
};

export function langColor(lang: string | null): string | null {
  return lang ? LANG_COLOR[lang.toLowerCase()] ?? null : null;
}

/** A repo's position in a list, with its neighbours, for prev/next in the focus view. */
export function neighbours(repos: string[], repo: string | null): { index: number; prev: string | null; next: string | null } | null {
  if (!repo) return null;
  const index = repos.findIndex((r) => r.toLowerCase() === repo.toLowerCase());
  if (index < 0) return null;
  return { index, prev: repos[index - 1] ?? null, next: repos[index + 1] ?? null };
}
