// Your repos (/me/repos, the dashboard plan): the repos you saved and
// the repos you checked, as one list with today's numbers on each. Pure, so
// it runs under `node --test`.
import { humanHours } from "./format.ts";
import type { DiscoverRepo, HistoryItem, SavedItem, Stats, Tone } from "./types";

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
  /** A check of yours is running (or queued) now, newer than the last finished one. */
  checking: boolean;
  /** Holt's current verdict: the latest free report when there is one, else your last check's. */
  headline: string | null;
  tone: Tone | null;
  /** From Holt's current card for the repo, when it has one. */
  stats: Stats | null;
  stars: number | null;
  /** Newest of saved and checked: the list's order. */
  at: string;
}

/** A check still queued or running after this long is stuck, not running. */
const RUNNING_FOR_AT_MOST_MS = 30 * 60 * 1000;

const withCard = (r: YourRepo, c: DiscoverRepo) =>
  Object.assign(r, { repo: c.repo, headline: c.headline, tone: c.tone, stats: c.stats, stars: c.stars });

/** One row per repo (case doesn't matter), newest activity first. `cards` are
 * the current cards for checked repos (`/me/history`); saved ones carry their own. */
export function yourRepos(saved: SavedItem[], history: HistoryItem[], cards: DiscoverRepo[] = [], now = Date.now()): YourRepo[] {
  const rows = new Map<string, YourRepo>();
  const row = (repo: string) => {
    const k = repo.toLowerCase();
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { repo, savedAt: null, checkedAt: null, ai: false, checking: false, headline: null, tone: null, stats: null, stars: null, at: "" }));
    return r;
  };
  // Checks still running: the row shows it, and sorts by when it started.
  const running = new Map<string, string>();
  for (const h of history) {
    if ((h.status !== "queued" && h.status !== "running") || now - Date.parse(h.created_at) > RUNNING_FOR_AT_MOST_MS) continue;
    row(h.repo);
    const k = h.repo.toLowerCase();
    if ((running.get(k) ?? "") < h.created_at) running.set(k, h.created_at);
  }
  for (const h of history) {
    if (h.status !== "done" || !h.headline || !h.tone) continue;
    const r = row(h.repo);
    if (r.checkedAt && r.checkedAt >= h.created_at) continue;
    Object.assign(r, { checkedAt: h.created_at, ai: h.mode === "ai" });
    if (!r.stats) Object.assign(r, { headline: h.headline, tone: h.tone });
  }
  for (const c of cards) {
    const r = rows.get(c.repo.toLowerCase());
    if (r) withCard(r, c);
  }
  for (const s of saved) {
    const r = row(s.card?.repo ?? s.repo);
    r.savedAt = s.saved_at;
    if (s.card) withCard(r, s.card);
  }
  for (const [k, started] of running) {
    const r = rows.get(k)!;
    r.checking = !r.checkedAt || started > r.checkedAt;
  }
  for (const [k, r] of rows) r.at = [r.savedAt, r.checkedAt, r.checking ? running.get(k)! : null].filter(Boolean).sort().at(-1) ?? "";
  return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/** A row's two facts in place of a verdict: do outside PRs get merged, and how soon does someone answer. */
export function repoNumbers(s: Stats): { merged: string; reply: string | null } {
  if (!s.outsider_attempts) return { merged: "no outside PRs yet", reply: null };
  const h = s.median_first_response_hours;
  return {
    merged: `${s.outsider_merged} of ${s.outsider_attempts} outside PRs merged`,
    reply: h == null ? "no replies yet" : `first reply in ${humanHours(h)}`,
  };
}

export function shown(rows: YourRepo[], show: Show): YourRepo[] {
  if (show === "saved") return rows.filter((r) => r.savedAt);
  if (show === "checked") return rows.filter((r) => r.checkedAt || r.checking);
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
