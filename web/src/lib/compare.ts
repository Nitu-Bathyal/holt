// /compare: reading the list from the URL, and which column leads on each
// number. Only the numbers the reports already show; no verdict changes.
// No imports beyond repo parsing and types, so it runs under `node --test`.
import { parseRepoInput } from "./repo.ts";
import type { Stats } from "./types.ts";

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

export type Lead = "merged" | "reply" | "firstTimers" | "silent";

/**
 * For each number, the columns (by index) that do best on it: highest share
 * merged, fastest first reply, most first-timers merged, lowest share with no
 * reply. Only when at least two columns have the number and they differ.
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
  };
}
