// PROTOTYPE, don't merge. Made-up account data for /lab/dashboard. Repo
// numbers match the local mock (lib/mock/server.ts) so nothing contradicts it.
import type { Tone } from "@/lib/types";

export interface LabRepo {
  repo: string;
  language: string;
  description: string;
  headline: string;
  tone: Tone;
  merged: number;
  attempts: number;
  replyHours: number;
  firstTimers: number;
  /** Why it's picked, in plain words: the first line is the main reason. */
  why: string[];
  issues: { number: number; title: string; labels: string[]; daysAgo: number }[];
}

const WORTH = { headline: "Worth your time", tone: "good" as Tone };
const NOT = { headline: "Not worth your time", tone: "bad" as Tone };

export const REPOS: Record<string, LabRepo> = {
  "pallets/click": {
    repo: "pallets/click", language: "Python", description: "Python composable command line interface toolkit", ...WORTH,
    merged: 19, attempts: 42, replyHours: 6, firstTimers: 9,
    why: ["Python, and you've had PRs merged in it", "replies within 6 hours"],
    issues: [
      { number: 2811, title: "Document how to test a command that reads from stdin", labels: ["good first issue", "docs"], daysAgo: 4 },
      { number: 2794, title: "Help text wraps badly for long option names", labels: ["good first issue"], daysAgo: 9 },
    ],
  },
  "Textualize/rich": {
    repo: "Textualize/rich", language: "Python", description: "Rich text and beautiful formatting in the terminal", ...WORTH,
    merged: 21, attempts: 60, replyHours: 14, firstTimers: 11,
    why: ["Python", "11 first-timers merged recently"],
    issues: [
      { number: 3512, title: "Add an example for Table.grid to the docs", labels: ["good first issue", "documentation"], daysAgo: 2 },
      { number: 3490, title: "Progress bar ignores refresh_per_second when paused", labels: ["good first issue", "bug"], daysAgo: 12 },
      { number: 3471, title: "Test coverage for Markdown tables with alignment", labels: ["good first issue", "tests"], daysAgo: 20 },
    ],
  },
  "astral-sh/ruff": {
    repo: "astral-sh/ruff", language: "Rust", description: "An extremely fast Python linter and code formatter", ...WORTH,
    merged: 70, attempts: 120, replyHours: 3, firstTimers: 22,
    why: ["Rust, where you've had PRs merged", "replies within 3 hours"],
    issues: [{ number: 13807, title: "Rule docs: add a fix example for PLR1714", labels: ["good first issue", "documentation"], daysAgo: 3 }],
  },
  "home-assistant/core": {
    repo: "home-assistant/core", language: "Python", description: "Open source home automation that puts local control first", ...WORTH,
    merged: 43, attempts: 58, replyHours: 15, firstTimers: 30,
    why: ["Python", "30 first-timers merged recently"],
    issues: [
      { number: 153512, title: "Roborock: expose the mop intensity as a select entity", labels: ["good first issue"], daysAgo: 1 },
      { number: 153201, title: "Typo in the Shelly config flow strings", labels: ["good first issue", "docs"], daysAgo: 6 },
    ],
  },
  "NixOS/nixpkgs": {
    repo: "NixOS/nixpkgs", language: "Nix", description: "Nix packages collection and NixOS", ...WORTH,
    merged: 35, attempts: 57, replyHours: 17, firstTimers: 12,
    why: ["Nix, where you've had PRs merged", "replies within 17 hours"],
    issues: [
      { number: 341220, title: "python3Packages.textual: 0.79.1 -> 0.80.0", labels: ["good first issue", "update"], daysAgo: 1 },
      { number: 340980, title: "nixos/tests: port the nginx test to the new runner", labels: ["good first issue"], daysAgo: 5 },
    ],
  },
  "pallets/flask": {
    repo: "pallets/flask", language: "Python", description: "The Python micro framework for building web applications", ...NOT,
    merged: 5, attempts: 171, replyHours: 0.7, firstTimers: 4, why: [], issues: [],
  },
  "psf/requests": {
    repo: "psf/requests", language: "Python", description: "A simple, yet elegant, HTTP library", ...WORTH,
    merged: 12, attempts: 30, replyHours: 20, firstTimers: 6, why: [], issues: [],
  },
  "pytorch/pytorch": {
    repo: "pytorch/pytorch", language: "Python", description: "Tensors and dynamic neural networks in Python", ...NOT,
    merged: 9, attempts: 214, replyHours: 60, firstTimers: 3, why: [], issues: [],
  },
};

export const PICKS = ["pallets/click", "Textualize/rich", "astral-sh/ruff"];
export const LANGUAGES = ["Python", "JavaScript", "TypeScript", "Go", "Rust", "Nix"];

export type PrState = "open" | "merged" | "closed";
export interface LabPR {
  repo: string;
  number: number;
  title: string;
  state: PrState;
  /** Hours since it was opened (open) or since it was decided (merged, closed). */
  hours: number;
  foundViaHolt?: boolean;
}

export const PRS: LabPR[] = [
  { repo: "home-assistant/core", number: 153340, title: "Add a battery sensor to the Roborock integration", state: "open", hours: 50, foundViaHolt: true },
  { repo: "NixOS/nixpkgs", number: 341002, title: "python3Packages.rich: 13.9.4 -> 13.9.5", state: "open", hours: 5 },
  { repo: "NixOS/nixpkgs", number: 339210, title: "python3Packages.rich: 13.7.1 -> 13.9.4", state: "merged", hours: 240, foundViaHolt: true },
  { repo: "octo/one", number: 88, title: "Fix a typo in the contributing guide", state: "merged", hours: 960 },
  { repo: "octo/two", number: 14, title: "Add a --quiet flag", state: "closed", hours: 2200 },
];

/** Your repos: saved or checked, newest first. */
export const MINE: { repo: string; how: "saved" | "checked"; hours: number }[] = [
  { repo: "home-assistant/core", how: "saved", hours: 30 },
  { repo: "pallets/flask", how: "saved", hours: 70 },
  { repo: "psf/requests", how: "checked", hours: 26 },
  { repo: "pytorch/pytorch", how: "checked", hours: 50 },
  { repo: "pallets/click", how: "checked", hours: 120 },
];

/** "2 days", "15 hours", "40 minutes". */
export function span(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 36) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const d = Math.round(hours / 24);
  if (d < 45) return `${d} day${d === 1 ? "" : "s"}`;
  return `${Math.round(d / 30)} months`;
}
