// Shapes the extension reads from the Holt public API. They are a subset of the
// Report and StarterIssue objects in API.md; everything else is ignored.

export type Verdict = "viable" | "not_viable" | "insufficient_evidence";

/** The verdict's colour, chosen by the server. */
export type Tone = "good" | "bad" | "warn";

export interface Report {
  repo: string;
  verdict: Verdict;
  /** The words for the verdict, from the server ("Worth your time"). */
  headline: string;
  /** Missing from responses cached before the server sent it. */
  tone?: Tone;
  /** A short count for the chip ("15 of 100 outside PRs merged"); null when
   * nobody outside tried. Missing from responses cached before it existed. */
  stat_line?: string | null;
  /** True when an older version of Holt's rules made this report; the chip
   * says "updating" instead of its verdict. Missing from older servers. */
  outdated?: boolean;
  stats?: {
    outsider_attempts?: number;
    outsider_merged?: number;
  } | null;
}

export interface StarterIssue {
  number: number;
  title?: string;
  url?: string;
  why?: string[];
  /** "Nobody on it yet", "1 open pull request", …; missing from older servers. */
  on_it?: string | null;
}

export interface StarterIssues {
  repo: string;
  issues: StarterIssue[];
}

/** What the background worker answers for one lookup. */
export type Lookup<T> =
  | { state: "found"; data: T }
  | { state: "missing" } // 404: nothing cached for this repo yet
  | { state: "error" }; // network, 5xx, bad JSON

export type LookupKind = "report" | "starter-issues";

export interface LookupMessage {
  type: "holt:lookup";
  kind: LookupKind;
  owner: string;
  repo: string;
}

export interface Repo {
  owner: string;
  repo: string;
}
