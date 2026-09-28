// "Watch Holt check a repo" (landing section 02, docs/design/EXPRESSIVE.md
// pattern 3): what the replay plays, built from the recorded example report
// (lib/example-report.ts), so its numbers are a real run's and never made up.
// Pure, so it runs under `node --test`.
import { pct, statLines } from "./format.ts";
import type { Report, Tone } from "./types.ts";

/** One printed line. `{n}` marks a number that counts up as the line prints. */
export interface ReplayLine {
  text: string;
  counts?: number[];
  style?: "heading" | "verdict" | "faint" | "good" | "bad";
}

export interface ReplayStat {
  big: string;
  label: string;
  tone: Tone | "neutral";
  meter?: number;
}

export interface Replay {
  repo: string;
  headline: string;
  tone: Tone;
  days: number;
  /** The web mode: the progress log's stages, then the verdict card. */
  stages: string[];
  line: string;
  stats: ReplayStat[];
  /** The terminal mode: `holt analyze`'s own output for the same run, trimmed. */
  command: string;
  terminal: ReplayLine[];
}

/** How the CLI words a typical wait: "48 minutes", "2.3 hours", "3 days". */
export function cliHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h < 48) return `${Number(h.toFixed(1))} hours`;
  return `${Math.round(h / 24)} days`;
}

export function buildReplay(r: Report): Replay {
  const s = r.stats;
  const replied = s.no_reply != null ? s.outsider_attempts - s.no_reply : null;
  const terminal: ReplayLine[] = [
    { text: `Reading recent pull requests for ${r.repo} from GitHub…`, style: "faint" },
    { text: r.repo, style: "heading" },
    { text: `${r.headline} — for a contributor with ${r.days} days.`, style: "verdict" },
  ];
  if (r.evidence_until) terminal.push({ text: `Evidence up to ${r.evidence_until.slice(0, 10)}.`, style: "faint" });
  terminal.push({
    // The CLI goes on "…, by N of the M people who tried": the stats here don't carry that N.
    text: "{n} of {n} pull requests from outside contributors were merged.",
    counts: [s.outsider_merged, s.outsider_attempts],
  });
  if (replied != null && s.median_first_response_hours != null)
    terminal.push({ text: `Of the {n} that got a reply, half heard back within ${cliHours(s.median_first_response_hours)}.`, counts: [replied] });
  if (s.no_reply != null) terminal.push({ text: "{n} got no reply at all.", counts: [s.no_reply], style: "bad" });
  if (r.landing.length) {
    terminal.push({ text: "Where outsider work landed", style: "heading" });
    for (const l of r.landing.slice(0, 2))
      terminal.push({ text: `• ${l.path} — {n} merged of {n} attempted (${pct(l.merged, l.attempted)}%)`, counts: [l.merged, l.attempted], style: "good" });
  }
  return {
    repo: r.repo,
    headline: r.headline,
    tone: r.tone,
    days: r.days,
    stages: ["Fetching pull requests", "Counting replies and merges", "Applying the rules"],
    line: r.verdict_line,
    stats: statLines(s).slice(0, 3).map(({ big, label, tone, meter }) => ({ big, label, tone, meter })),
    command: `holt analyze ${r.repo} --live --no-model`,
    terminal,
  };
}

/** A line as plain text, numbers filled in: what screen readers get. */
export function plainLine(l: ReplayLine): string {
  let i = 0;
  return l.text.replace(/\{n\}/g, () => String(l.counts?.[i++] ?? ""));
}
