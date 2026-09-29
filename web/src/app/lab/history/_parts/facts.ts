// PROTOTYPE, don't merge. What each concept says, derived from the data and
// nothing else: if a fact needs a number Holt doesn't have, it isn't said.
import { TODAY, WINDOW_START, type Persona, type Pr, type Repo } from "./data";

const DAY = 864e5;

/** The PRs that count: team and personal repos only when the owner counts them. */
export function counted(p: Persona, withTeam: boolean): Pr[] {
  return p.prs.filter((x) => withTeam || !p.repos[x.repo]?.team);
}

export const inOctober = (x: Pr) => x.opened.startsWith("2026-10");

export const tookDays = (x: Pr) => (x.done ? (Date.parse(x.done) - Date.parse(x.opened)) / DAY : Infinity);

export function duration(days: number): string {
  if (days < 1) {
    const h = Math.max(1, Math.round(days * 24));
    return h === 1 ? "an hour" : `${h} hours`;
  }
  const d = Math.round(days);
  return d === 1 ? "a day" : `${d} days`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function day(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${y === new Date(TODAY).getUTCFullYear() ? "" : ` ${y}`}`;
}
export const since = () => day(WINDOW_START);

export const merged = (prs: Pr[]) => prs.filter((x) => x.state === "merged").sort((a, b) => Date.parse(a.done!) - Date.parse(b.done!));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const rate = (r?: Repo) => (r?.outsideTried ? (r.outsideMerged ?? 0) / r.outsideTried : undefined);
/** "3 in 10": the report's share, in words a beginner reads at a glance. */
export const inTen = (r: Repo) => Math.round((rate(r) ?? 0) * 10);
export const url = (x: Pr) => `https://github.com/${x.repo}/pull/${x.number}`;

/** Repos with at least one counted PR, most merged first. */
export function repoList(prs: Pr[]) {
  const by = new Map<string, Pr[]>();
  for (const x of prs) by.set(x.repo, [...(by.get(x.repo) ?? []), x]);
  return [...by.entries()]
    .map(([repo, list]) => ({ repo, prs: list, merged: list.filter((x) => x.state === "merged").length }))
    .sort((a, b) => b.merged - a.merged || b.prs.length - a.prs.length);
}

/** Under this share, "most outside PRs don't get merged here" reads true at a glance (3 in 10 or fewer). */
export const HARD = 0.35;

/** Repos you got merged in where most outside PRs don't. */
export function gotIn(prs: Pr[], repos: Record<string, Repo>) {
  return repoList(prs).filter((r) => r.merged > 0 && (rate(repos[r.repo]) ?? 1) < HARD);
}

/** Each merged PR that took under half its repo's typical wait, fastest first. */
export function faster(prs: Pr[], repos: Record<string, Repo>) {
  return merged(prs)
    .filter((x) => repos[x.repo]?.typicalMergeDays && tookDays(x) < repos[x.repo].typicalMergeDays! / 2)
    .sort((a, b) => tookDays(a) / repos[a.repo].typicalMergeDays! - tookDays(b) / repos[b.repo].typicalMergeDays!);
}

export function languages(prs: Pr[], repos: Record<string, Repo>) {
  const n = new Map<string, number>();
  for (const x of merged(prs)) n.set(repos[x.repo].language, (n.get(repos[x.repo].language) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

/** The folder most of a repo's merged work sits in (its first path segment). */
export function topFolder(prs: Pr[]) {
  const n = new Map<string, number>();
  for (const x of prs) for (const f of x.files) {
    const top = f.includes("/") ? `${f.split("/")[0]}/` : f;
    n.set(top, (n.get(top) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ---- the changelog ------------------------------------------------------------------

export type Note =
  | { kind: "first" }
  | { kind: "repo" }
  | { kind: "language"; language: string }
  | { kind: "faster"; took: number; typical: number }
  | { kind: "odds"; inTen: number }
  | { kind: "count"; n: number }
  | { kind: "holt" };

export interface Release { version: string; pr: Pr; notes: Note[]; also: Pr[] }

const COUNTS = [10, 25, 50, 100, 200, 250, 300];

/**
 * One release per merged PR that's a first or a round number; the merged PRs
 * in between ride along as `also`. The version is 1.<repos>.<merged>, so it
 * reads back: 1.6.10 is six repos, ten merged. Before a first merge it's 0.x.
 */
export function releases(prs: Pr[], repos: Record<string, Repo>, hadMergesBefore: boolean): Release[] {
  const out: Release[] = [];
  const seenRepos = new Set<string>();
  const seenLangs = new Set<string>();
  const fastIn = new Set<string>();
  let m = 0;
  for (const x of merged(prs)) {
    m++;
    const info = repos[x.repo];
    const notes: Note[] = [];
    if (m === 1) notes.push({ kind: "first" });
    if (!seenRepos.has(x.repo)) {
      seenRepos.add(x.repo);
      if (m > 1) notes.push({ kind: "repo" });
      const r = rate(info);
      if (r !== undefined && r < HARD) notes.push({ kind: "odds", inTen: inTen(info) });
    }
    if (!seenLangs.has(info.language)) {
      seenLangs.add(info.language);
      if (m > 1 || hadMergesBefore) notes.push({ kind: "language", language: info.language });
    }
    const typical = info.typicalMergeDays;
    if (typical && tookDays(x) < typical / 2 && !fastIn.has(x.repo)) {
      fastIn.add(x.repo);
      notes.push({ kind: "faster", took: tookDays(x), typical });
    }
    if (COUNTS.includes(m)) notes.push({ kind: "count", n: m });
    if (x.viaHolt) notes.push({ kind: "holt" });
    const version = `1.${seenRepos.size}.${m}`;
    if (notes.length || !out.length) out.push({ version, pr: x, notes, also: [] });
    else out[out.length - 1].also.push(x);
  }
  return out.reverse();
}

export function version(prs: Pr[]) {
  const m = merged(prs);
  if (!m.length) return `0.${prs.length}.0`;
  return `1.${new Set(m.map((x) => x.repo)).size}.${m.length}`;
}

const usual = (x: Pr, repos?: Record<string, Repo>) => {
  const t = repos?.[x.repo]?.typicalMergeDays;
  return t && tookDays(x) < t ? ` It usually takes ${duration(t)}.` : "";
};

// ---- the story ----------------------------------------------------------------------

export type Mood = "ready" | "celebrating" | "adoring" | "determined" | "thinking" | "startled";
export type Slide =
  | { id: string; kind: "big"; mood: Mood; kicker?: string; big: string; line: string }
  | { id: "card"; kind: "card"; mood: Mood };

export interface CardFact { id: string; text: string; on: boolean }

/** The story's slides: only the ones this person's data can say honestly. */
export function story(prs: Pr[], p: Persona, range: "year" | "october"): { slides: Slide[]; facts: CardFact[] } {
  const list = range === "october" ? prs.filter(inOctober) : prs;
  const m = merged(list);
  const repos = repoList(list);
  const when = range === "october" ? "This October" : "This year";
  const slides: Slide[] = [];
  const facts: CardFact[] = [];

  if (!list.length) {
    return { slides: [{ id: "none", kind: "big", mood: "thinking", kicker: when, big: "Not yet.", line: "" }], facts: [] };
  }
  const first = list.length === 1 && !p.before;
  slides.push({
    id: "open", kind: "big", mood: "ready", kicker: when,
    big: first ? "Your first PR." : plural(list.length, "PR"),
    line: first ? `Opened ${day(list[0].opened)}.` : `opened, in ${plural(repos.length, "repo")}.`,
  });

  if (m.length) {
    const waiting = list.filter((x) => x.state === "open").length;
    slides.push({
      id: "merged", kind: "big", mood: "celebrating",
      big: m.length === 1 && first ? "Merged." : `${m.length} merged.`,
      line: m.length === 1 && first ? `In ${duration(tookDays(m[0]))}.${usual(m[0], p.repos)}` : waiting ? `${waiting} still waiting.` : "",
    });
    const places = new Set(m.map((x) => x.repo));
    const where = places.size === 1 ? m[0].repo : plural(places.size, "repo");
    facts.push({ id: "merged", text: m.length === 1 && first ? `first PR merged, in ${where}` : `${plural(m.length, "PR")} merged in ${where}`, on: true });
  } else if (list.length) {
    slides.push({ id: "merged", kind: "big", mood: "thinking", big: `${list.filter((x) => x.state === "open").length} waiting.`, line: "" });
  }

  const top = repos[0];
  if (top?.merged) {
    const folder = topFolder(top.prs.filter((x) => x.state === "merged"));
    slides.push({
      id: "landed", kind: "big", mood: "adoring", kicker: top.merged === m.length ? "It all landed in" : "Most of it landed in",
      big: top.repo, line: folder ? `In ${folder}` : "",
    });
    if (repos.filter((r) => r.merged).length > 1) facts.push({ id: "landed", text: `most at home in ${top.repo}`, on: true });
  }

  const got = gotIn(list, p.repos);
  if (got.length) {
    const g = got[0];
    slides.push({
      id: "odds", kind: "big", mood: "determined", kicker: "You got into",
      big: g.repo, line: `${inTen(p.repos[g.repo])} in 10 outside PRs get merged there. ${g.merged === 1 ? "Yours did." : `${g.merged} of yours did.`}`,
    });
    facts.push({ id: "odds", text: `got into ${g.repo}`, on: true });
  }

  const fast = faster(list, p.repos)[0];
  if (fast && m.length > 1) {
    const typical = p.repos[fast.repo].typicalMergeDays!;
    slides.push({
      id: "fast", kind: "big", mood: "startled", kicker: "Fastest merge",
      big: duration(tookDays(fast)), line: `${fast.repo}. It usually takes ${duration(typical)}.`,
    });
    facts.push({ id: "fast", text: `merged in ${duration(tookDays(fast))} at ${fast.repo}`, on: true });
  }

  const langs = languages(list, p.repos);
  if (langs.length > 1) {
    slides.push({ id: "langs", kind: "big", mood: "ready", kicker: "Shipped in", big: langs.slice(0, 4).join("\n"), line: langs.length > 4 ? `and ${langs.length - 4} more.` : "" });
    facts.push({ id: "langs", text: langs.slice(0, 3).join(", "), on: true });
  }

  const holt = m.filter((x) => x.viaHolt).length;
  if (holt) facts.push({ id: "holt", text: `${plural(holt, "merged PR")} found on Holt`, on: false });

  slides.push({ id: "card", kind: "card", mood: "celebrating" });
  return { slides, facts };
}
