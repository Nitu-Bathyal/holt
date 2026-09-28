// Discover and the "most welcoming <language> repos" boards (API.md,
// GET /v1/discover): URL slugs for languages and the words for each board.
import type { DiscoverSort } from "./types";

export const SORTS: { id: DiscoverSort; label: string }[] = [
  { id: "welcoming", label: "Most welcoming" },
  { id: "stars", label: "Most stars" },
  { id: "trending", label: "Checked most this week" },
];

export function parseSort(v: string | string[] | undefined): DiscoverSort {
  const s = Array.isArray(v) ? v[0] : v;
  return SORTS.some((x) => x.id === s) ? (s as DiscoverSort) : "welcoming";
}

const SPECIAL: Record<string, string> = { "c++": "cpp", "c#": "csharp", "f#": "fsharp" };

/** GitHub's language name -> the path segment: "C++" -> "cpp", "Jupyter Notebook" -> "jupyter-notebook". */
export function languageSlug(name: string): string {
  const n = name.trim().toLowerCase();
  return SPECIAL[n] ?? encodeURIComponent(n.replace(/\s+/g, "-"));
}

/** The language a slug stands for, among the ones the server offers; null if none. */
export function languageFromSlug(slug: string, names: string[]): string | null {
  const s = slug.trim().toLowerCase();
  return names.find((n) => languageSlug(n) === s || languageSlug(n) === encodeURIComponent(s)) ?? null;
}

export function boardTitle(sort: DiscoverSort, language: string | null): string {
  const lang = language ? `${language} ` : "";
  if (sort === "stars") return `The biggest ${lang}repos Holt has checked`;
  if (sort === "trending") return language ? `${language} repos people checked most this week` : "Repos people checked most this week";
  return `Most welcoming ${lang}repos`;
}

export function boardIntro(sort: DiscoverSort, trendingMin: number): string {
  if (sort === "stars") return "Every repo Holt has checked, biggest first, with its verdict. A famous project isn't always a welcoming one.";
  if (sort === "trending")
    return `Repos that at least ${trendingMin} people checked on Holt in the last 7 days. Each person counts once a day.`;
  return "Only repos that are worth your time, ranked by how many outside pull requests get merged and how fast someone replies. No AI picks the order, and nobody can pay to be here.";
}

export function emptyText(sort: DiscoverSort, language: string | null, topic: string | null, trendingMin: number): string {
  const repo = `${language ? `${language} ` : ""}repo${topic ? ` tagged "${topic}"` : ""}`;
  if (sort === "trending") return `No ${repo} has been checked by ${trendingMin} or more people this week yet.`;
  if (sort === "welcoming") return `No ${repo} Holt has checked is worth your time yet.`;
  return `Holt hasn't checked a ${repo} yet.`;
}

/** The board's path: /discover or /discover/<language>, with sort and topic kept. */
export function boardHref(opts: { sort?: DiscoverSort; language?: string | null; topic?: string | null }): string {
  const path = opts.language ? `/discover/${languageSlug(opts.language)}` : "/discover";
  const q = new URLSearchParams();
  if (opts.sort && opts.sort !== "welcoming") q.set("sort", opts.sort);
  if (opts.topic) q.set("topic", opts.topic);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
