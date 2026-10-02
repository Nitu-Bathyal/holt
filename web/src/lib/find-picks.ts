// What a /find search is made of, and where it comes from: the URL, the
// viewer's last picks (a cookie, so the first paint already has them), their
// profile, or the defaults. The URL format is the one the old find form
// submitted, so profile links (findHref) and shared searches keep working.
// No imports beyond types, so it runs under `node --test` and in the browser.
import { contributions, days as daysOf, level as levelOf, topics as topicsOf } from "./profile.ts";
import type { ContributionType, FindQuery, Level, ProfilePrefs } from "./types.ts";

/** Remembers the last search, as its query string. Read by the server, written by the page. */
export const PICKS_COOKIE = "holt_find";

export interface Picks {
  langs: string[];
  days: number;
  topics: string[];
  hf: boolean;
  /** Applied to results in the browser (personalise); they never change the search. */
  level: Level;
  types: ContributionType[];
}

export type PicksSource = "url" | "last" | "profile" | "default";

type Params = Record<string, string | string[] | undefined>;

const KEYS = ["go", "lang", "days", "topics", "level", "type", "hacktoberfest"];
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);

export function defaultPicks(hfOn: boolean): Picks {
  return { langs: [], days: 7, topics: [], hf: hfOn, level: "experienced", types: [] };
}

/** Picks from URL params, or null when the URL has none (then something else decides). */
export function picksFromParams(sp: Params): Picks | null {
  if (!KEYS.some((k) => sp[k] != null)) return null;
  const langs = [...new Set(list(sp.lang).map((l) => l.toLowerCase()).filter((l) => l.length <= 40))].slice(0, 10);
  return {
    langs,
    days: daysOf(first(sp.days)),
    topics: topicsOf(list(sp.topics).join(",")),
    // A search without the switch means off, as the old form sent it.
    hf: first(sp.hacktoberfest) === "1",
    level: levelOf(first(sp.level)),
    types: contributions(list(sp.type)),
  };
}

export function picksFromQuery(q: string | undefined): Picks | null {
  if (!q) return null;
  const sp: Params = {};
  try {
    for (const [k, v] of new URLSearchParams(q)) {
      const had = sp[k];
      sp[k] = had == null ? v : [...(Array.isArray(had) ? had : [had]), v];
    }
  } catch {
    return null;
  }
  return picksFromParams(sp);
}

export function picksFromProfile(p: Omit<ProfilePrefs, "updated_at">, hfOn: boolean): Picks {
  return { langs: p.languages, days: daysOf(p.days), topics: p.topics, hf: hfOn, level: p.level, types: p.contributions };
}

/**
 * The picks a visit starts from: a search in the URL, else the last picks, else
 * the profile, else the defaults. Outside the Hacktoberfest window the switch
 * is hidden, so it is always off.
 */
export function resolvePicks(
  { params, cookie, profile, hfWindow, hfOn }: { params: Params; cookie?: string; profile: Omit<ProfilePrefs, "updated_at"> | null; hfWindow: boolean; hfOn: boolean },
): { picks: Picks; source: PicksSource } {
  const url = picksFromParams(params);
  const last = url ? null : picksFromQuery(cookie);
  const [picks, source]: [Picks, PicksSource] = url
    ? [url, "url"]
    : last
      ? [last, "last"]
      : profile
        ? [picksFromProfile(profile, hfOn), "profile"]
        : [defaultPicks(hfOn), "default"];
  return { picks: hfWindow ? picks : { ...picks, hf: false }, source };
}

/** The query string for these picks: stable order, so equal picks give equal strings. */
export function picksQuery(p: Picks): string {
  const q = new URLSearchParams();
  for (const l of [...p.langs].sort()) q.append("lang", l);
  q.set("days", String(p.days));
  if (p.topics.length) q.set("topics", p.topics.join(","));
  q.set("hacktoberfest", p.hf ? "1" : "0");
  if (p.level !== "experienced") q.set("level", p.level);
  for (const t of [...p.types].sort()) q.append("type", t);
  return q.toString();
}

/** How many results a find page starts with; the list loads the rest of the index as it is scrolled. */
export const FIND_FIRST = 12;

/** The part of the picks the server searches on (the rest is applied in the browser). */
export function findQuery(p: Picks, limit = FIND_FIRST): FindQuery {
  return { languages: p.langs, topics: p.topics, days: p.days, hacktoberfest: p.hf, limit };
}

/** Equal for picks that need the same search upstream. */
export function searchKey(p: Picks): string {
  return JSON.stringify([[...p.langs].sort(), [...p.topics].sort(), p.days, p.hf]);
}

/** How many of the tucked-away filters (experience, work type, topics) are set. */
export function extraCount(p: Picks): number {
  return (p.level === "newcomer" ? 1 : 0) + p.types.length + (p.topics.length ? 1 : 0);
}

/** One-tap ways to widen a search that found nothing, most likely to help first. */
export function widen(p: Picks): { label: string; picks: Picks }[] {
  const out: { label: string; picks: Picks }[] = [];
  if (p.topics.length) out.push({ label: "Drop the topics", picks: { ...p, topics: [] } });
  if (p.hf) out.push({ label: "Include repos outside Hacktoberfest", picks: { ...p, hf: false } });
  if (p.level === "newcomer") out.push({ label: "Show all starter issues", picks: { ...p, level: "experienced" } });
  if (p.langs.length) out.push({ label: "Any language", picks: { ...p, langs: [] } });
  if (p.days < 30) out.push({ label: "I have a month", picks: { ...p, days: 30 } });
  return out.slice(0, 3);
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
