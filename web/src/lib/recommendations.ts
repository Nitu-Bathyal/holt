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
