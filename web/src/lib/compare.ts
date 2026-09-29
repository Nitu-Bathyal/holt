// /compare: reading the list from the URL, and which column leads on each
// number. Only the numbers the reports already show; no verdict changes.
// No imports beyond repo parsing and types, so it runs under `node --test`.
import { parseRepoInput } from "./repo.ts";
import { humanHours, pct } from "./format.ts";
import type { Report, Stats } from "./types.ts";

export const MAX = 4;

/** Repos from `?repos=` or `?add=` (commas or spaces; names or URLs), de-duplicated, at most MAX. */
export function parseList(v: string | string[] | undefined): string[] {
  const raw = (Array.isArray(v) ? v.join(",") : v ?? "").split(/[,\s]+/);
  const out: string[] = [];
  for (const r of raw) {
    const ref = parseRepoInput(r);
    const name = ref && `${ref.owner}/${ref.repo}`;
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, MAX);
}

export function compareHref(list: string[]): string {
  return list.length ? `/compare?repos=${list.join(",")}` : "/compare";
}

/** Well-known repos for the example on an empty page; only ones with a report already cached are shown. */
export const EXAMPLE_POOL = ["pallets/flask", "psf/requests", "pytorch/pytorch", "home-assistant/core", "NixOS/nixpkgs", "django/django", "facebook/react", "microsoft/vscode"];

/** One-tap comparisons people often want. */
export const SUGGESTIONS: { label: string; repos: string[] }[] = [
  { label: "flask vs django vs fastapi", repos: ["pallets/flask", "django/django", "fastapi/fastapi"] },
  { label: "react vs vue vs svelte", repos: ["facebook/react", "vuejs/core", "sveltejs/svelte"] },
  { label: "rust vs go", repos: ["rust-lang/rust", "golang/go"] },
];

export type Lead = "merged" | "reply" | "firstTimers" | "silent" | "closed";

/**
 * For each number, the columns (by index) that do best on it: highest share
 * merged, fastest first reply, most first-timers merged, lowest share with no
 * reply, lowest share closed without a word. Only when at least two columns
 * have the number and they differ.
 */
export function leaders(stats: (Stats | null)[]): Record<Lead, number[]> {
  const share = (n: number, d: number) => (d > 0 ? n / d : null);
  const pick = (vals: (number | null)[], better: "high" | "low"): number[] => {
    const known = vals.filter((v): v is number => v != null);
    if (known.length < 2 || known.every((v) => v === known[0])) return [];
    const best = better === "high" ? Math.max(...known) : Math.min(...known);
    return vals.flatMap((v, i) => (v === best ? [i] : []));
  };
  return {
    merged: pick(stats.map((s) => (s ? share(s.outsider_merged, s.outsider_attempts) : null)), "high"),
    reply: pick(stats.map((s) => s?.median_first_response_hours ?? null), "low"),
    firstTimers: pick(stats.map((s) => s?.first_time_merged_authors ?? null), "high"),
    silent: pick(stats.map((s) => (s ? share(s.no_reply, s.outsider_attempts) : null)), "low"),
    closed: pick(stats.map((s) => (s ? share(s.closed_silently, s.outsider_attempts) : null)), "low"),
  };
}

/**
 * The page's one sentence: the repo that merges outsiders most often, once
 * you've picked two or more and one of them clearly leads; otherwise the
 * question the page answers.
 */
export function compareTitle(picked: boolean, repos: string[], lead: Record<Lead, number[]>): string {
  const top = lead.merged;
  if (picked && repos.length >= 2 && top.length === 1) return `${repos[top[0]]} merges outsiders most often.`;
  return "Which one will review your pull request?";
}

/** The numbers compared, one row each, in the order they're read. */
export const ROWS: { id: Lead | "way"; label: string }[] = [
  { id: "merged", label: "Outside PRs merged" },
  { id: "reply", label: "Typical first reply" },
  { id: "firstTimers", label: "First-timers merged" },
  { id: "silent", label: "Sat open, no reply" },
  { id: "closed", label: "Closed without a word" },
  { id: "way", label: "Best way in" },
];

export interface Cell {
  /** The number to scan. */
  main: string;
  /** What it's out of, when that matters. */
  sub?: string;
  /** "bad" for a number that's a warning on its own; "none" for nothing to show. */
  tone?: "bad" | "none";
}

/** One column's cells, from what the report already says. */
export function cells(report: Pick<Report, "stats" | "landing">): Record<Lead | "way", Cell> {
  const s = report.stats;
  const n = s.outsider_attempts;
  const none: Cell = { main: "–", tone: "none" };
  const share = (k: number): Cell => (n > 0 ? { main: `${pct(k, n)}%` } : none);
  const top = report.landing[0];
  return {
    merged: n > 0 ? { main: `${pct(s.outsider_merged, n)}%`, sub: `${s.outsider_merged} of ${n}` } : { main: "–", sub: "no outside PRs", tone: "none" },
    reply: s.median_first_response_hours == null ? (n > 0 ? { main: "no replies", tone: "bad" } : none) : { main: humanHours(s.median_first_response_hours) },
    firstTimers: { main: String(s.first_time_merged_authors), ...(s.first_time_merged_authors === 0 && n > 0 ? { tone: "bad" as const } : {}) },
    silent: share(s.no_reply),
    closed: share(s.closed_silently),
    way: top ? { main: top.path.startsWith("(") ? top.path : `${top.path}/` } : { main: "none yet", tone: "none" },
  };
}
