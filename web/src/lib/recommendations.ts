// Recommendations for you (API.md): the wording around the picks. The picks,
// their order and their reasons all come from the server's rules. Pure, so it
// runs under `node --test`.
import { LANGS } from "./profile.ts";
import type { Recommendation, RecommendationBasis, StarterIssue } from "./types";

/** "python" as the profile stores it -> "Python" as people write it. */
export function languageName(lang: string): string {
  return LANGS.find((l) => l.toLowerCase() === lang.toLowerCase()) ?? lang;
}

export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** One sentence on what the picks were matched on, or null when nothing was. */
export function basisLine(b: RecommendationBasis): string | null {
  const stated = [...b.languages.map(languageName), ...b.topics];
  const parts: string[] = [];
  if (stated.length) parts.push(`${listWords(stated.slice(0, 6))} from your profile`);
  if (b.history_languages.length) parts.push(`${listWords(b.history_languages.slice(0, 3))} from the pull requests you've had merged`);
  if (!parts.length) return null;
  return `Matched on ${parts.join(", and ")}.`;
}

/** Repos left out because the user already sent them a pull request. */
export function excludedLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "We left out the 1 repo you've already sent a pull request to."
    : `We left out the ${n} repos you've already sent pull requests to.`;
}

export type EmptyReason = "nothing-to-match" | "no-match";

/** Why there are no picks: nothing to go on yet, or nothing fits right now. */
export function emptyReason(b: RecommendationBasis): EmptyReason {
  const hasSignals = b.languages.length + b.topics.length + b.history_languages.length > 0;
  return hasSignals ? "no-match" : "nothing-to-match";
}

/** Up to `max` issues to start with, taken across the picks in turn (each
 * pick's first, then each one's second), so no one repo fills the list. */
export function starterRows(picks: Pick<Recommendation, "repo" | "issues">[], max: number): { repo: string; issue: StarterIssue }[] {
  const rows: { repo: string; issue: StarterIssue }[] = [];
  const deepest = Math.max(0, ...picks.map((p) => p.issues.length));
  for (let i = 0; i < deepest; i++) {
    for (const p of picks) if (p.issues[i]) rows.push({ repo: p.repo, issue: p.issues[i] });
  }
  return rows.slice(0, max);
}

/** The home shows this many picks; /me/picks has the rest. */
export const HOME_PICKS = 3;
/** One part of /me/picks: whole rows at one, two, three and four cards across. */
export const PICKS_PART = 12;

/** The home's link to every pick, or null when the home already shows them all. */
export function allPicksLabel(total: number): string | null {
  return total > HOME_PICKS ? `all ${total} picks` : null;
}

/**
 * Whether a pick's card carries its reason (why this repo for this person):
 * the server's first `why` line, which is the language or topic it matched
 * on. Not for picks matched on nothing (a new account): their reasons are
 * about the repo, and the card already shows those numbers.
 */
export function cardReasons(b: RecommendationBasis): boolean {
  return emptyReason(b) === "no-match";
}

/** The server's `next` (an offset) as the cursor a list that loads in parts asks with (lib/parts.ts). */
export function pickCursor(next: number | null | undefined): string | null {
  return next == null ? null : String(next);
}

/** A cursor back as the offset its part starts at: a whole number from 0 (none: the start), or null when it isn't one. */
export function parseOffset(raw: string | null): number | null {
  if (raw === null) return 0;
  return /^\d{1,4}$/.test(raw) ? Number(raw) : null;
}

export interface NoPicks {
  line: string;
  /** What gets some, the first one loudest. "github" only for someone not connected. */
  actions: ("profile" | "github")[];
}

/** /me/picks with no picks at all: one line and the way to get some. */
export function noPicks(b: RecommendationBasis): NoPicks {
  const actions: NoPicks["actions"] = b.connected ? ["profile"] : ["profile", "github"];
  return emptyReason(b) === "nothing-to-match"
    ? { line: "No picks yet.", actions }
    : { line: "Nothing fits your profile right now.", actions };
}
