// Your repos (/me/repos, docs/design/DASHBOARD.md): the repos you saved and
// the repos you checked, as one list with today's verdict on each. Pure, so
// it runs under `node --test`.
import type { HistoryItem, SavedItem, Stats, Tone } from "./types";

export type Show = "all" | "saved" | "checked";

export function parseShow(v: string | string[] | undefined): Show {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "saved" || s === "checked" ? s : "all";
}

export interface YourRepo {
  repo: string;
  savedAt: string | null;
  /** Your latest finished check, and whether it was an AI report. */
  checkedAt: string | null;
  ai: boolean;
  /** Holt's current verdict: the latest free report when there is one, else your last check's. */
  headline: string | null;
  tone: Tone | null;
  stats: Stats | null;
  /** Newest of saved and checked: the list's order. */
  at: string;
}

/** One row per repo (case doesn't matter), newest activity first. */
export function yourRepos(saved: SavedItem[], history: HistoryItem[]): YourRepo[] {
  const rows = new Map<string, YourRepo>();
  const row = (repo: string) => {
    const k = repo.toLowerCase();
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { repo, savedAt: null, checkedAt: null, ai: false, headline: null, tone: null, stats: null, at: "" }));
    return r;
  };
  for (const h of history) {
    if (h.status !== "done" || !h.headline || !h.tone) continue;
    const r = row(h.repo);
    if (r.checkedAt && r.checkedAt >= h.created_at) continue;
    Object.assign(r, { checkedAt: h.created_at, ai: h.mode === "ai" });
    if (!r.stats) Object.assign(r, { headline: h.headline, tone: h.tone });
  }
  for (const s of saved) {
    const r = row(s.card?.repo ?? s.repo);
    r.savedAt = s.saved_at;
    if (s.card) Object.assign(r, { repo: s.card.repo, headline: s.card.headline, tone: s.card.tone, stats: s.card.stats });
  }
  for (const r of rows.values()) r.at = [r.savedAt, r.checkedAt].filter(Boolean).sort().at(-1) ?? "";
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function shown(rows: YourRepo[], show: Show): YourRepo[] {
  if (show === "saved") return rows.filter((r) => r.savedAt);
  if (show === "checked") return rows.filter((r) => r.checkedAt);
  return rows;
}

/** The page's sentence: "7 repos you saved or checked". */
export function reposTitle(rows: YourRepo[]): string {
  if (!rows.length) return "No repos yet.";
  return `${rows.length} repo${rows.length === 1 ? "" : "s"} you saved or checked.`;
}

/** Where compare goes for the ticked repos (2 to 4). */
export function compareHref(repos: string[]): string | null {
  return repos.length >= 2 ? `/compare?repos=${repos.slice(0, 4).join(",")}` : null;
}
