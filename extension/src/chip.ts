import { reportPageUrl } from "./config";
import type { Lookup, Report, Repo, Tone } from "./types";

export const CHIP_CLASS = "holt-chip";

const TONES: readonly string[] = ["good", "bad", "warn"] satisfies Tone[];
const MAX_HEADLINE = 60;

export type ChipState = { state: "loading" } | Lookup<Report>;

export interface ChipView {
  tone: Tone | "unknown";
  label: string;
  stat: string | null;
  title: string;
}

/** The words and colour the chip shows for a lookup result. Pure; no DOM. */
export function chipView(s: ChipState, r: Repo): ChipView {
  const name = `${r.owner}/${r.repo}`;
  if (s.state === "loading") {
    return { tone: "unknown", label: "Holt", stat: "checking…", title: `Looking up ${name} on Holt` };
  }
  // An older version of Holt's rules made this report: its verdict may be out
  // of date, so it isn't shown. The report page checks again.
  if (s.state === "found" && s.data.outdated === true) {
    return {
      tone: "unknown",
      label: "Holt: updating",
      stat: null,
      title: `Holt's rules were updated. Click to check ${name} again.`,
    };
  }
  // The server words and colours the verdict; the chip only shows it. Anything
  // that isn't a short headline is treated as no answer.
  const headline = s.state === "found" ? s.data.headline : undefined;
  if (s.state === "found" && typeof headline === "string" && headline && headline.length <= MAX_HEADLINE) {
    const tone = s.data.tone;
    return {
      tone: typeof tone === "string" && TONES.includes(tone) ? tone : "unknown",
      label: `Holt: ${headline}`,
      stat: statLine(s.data),
      title: `Holt's verdict for newcomers to ${name}. Click for the full report.`,
    };
  }
  return {
    tone: "unknown",
    label: "Check with Holt",
    stat: null,
    title: `See whether ${name} is worth a first contribution. Opens Holt.`,
  };
}

const MAX_STAT = 60;

/**
 * One short stat, e.g. "15 of 100 outside PRs merged": the server's
 * `stat_line`, so the chip and the report page use the same words. Responses
 * from before the server sent it get the same sentence built here. Null when
 * there is nothing to count.
 */
export function statLine(report: Report): string | null {
  const line = report.stat_line;
  if (typeof line === "string" && line && line.length <= MAX_STAT) return line;
  if (line === null) return null;
  const attempts = report.stats?.outsider_attempts;
  const merged = report.stats?.outsider_merged;
  if (!isCount(attempts) || !isCount(merged) || attempts === 0) return null;
  const noun = attempts === 1 ? "outside PR" : "outside PRs";
  return `${merged} of ${attempts} ${noun} merged`;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Builds the chip element. Text only goes in via textContent, never HTML. */
export function createChip(doc: Document, r: Repo, s: ChipState): HTMLAnchorElement {
  const a = doc.createElement("a");
  a.className = CHIP_CLASS;
  a.href = reportPageUrl(r.owner, r.repo);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.dataset.holtRepo = `${r.owner}/${r.repo}`.toLowerCase();
  const dot = doc.createElement("span");
  dot.className = "holt-chip__dot";
  dot.setAttribute("aria-hidden", "true");
  const label = doc.createElement("span");
  label.className = "holt-chip__label";
  const stat = doc.createElement("span");
  stat.className = "holt-chip__stat";
  a.append(dot, label, stat);
  updateChip(a, r, s);
  return a;
}

export function updateChip(a: HTMLAnchorElement, r: Repo, s: ChipState): void {
  const v = chipView(s, r);
  a.dataset.holtTone = v.tone;
  a.dataset.holtState = s.state;
  // While loading the chip is a skeleton (content.css): the words are still
  // there for assistive tech, drawn as blocks with a shimmer for everyone else.
  if (s.state === "loading") a.setAttribute("aria-busy", "true");
  else a.removeAttribute("aria-busy");
  a.title = v.title;
  a.setAttribute("aria-label", v.stat ? `${v.label}. ${v.stat}.` : v.label);
  a.querySelector(".holt-chip__label")!.textContent = v.label;
  const stat = a.querySelector<HTMLElement>(".holt-chip__stat")!;
  stat.textContent = v.stat ?? "";
  stat.hidden = !v.stat;
}

// Where the repo title lives, newest GitHub layout first. Each entry says how
// to place the chip relative to the matched element.
const ANCHORS: Array<[selector: string, where: "append" | "after"]> = [
  ["#repo-title-component", "append"],
  ["#repository-container-header strong[itemprop='name']", "after"],
  ["[itemprop='name'] > a[href]", "after"],
];

export function findAnchor(doc: Document): { el: Element; where: "append" | "after" } | null {
  for (const [sel, where] of ANCHORS) {
    const el = doc.querySelector(sel);
    if (el) return { el, where };
  }
  return null;
}

/**
 * Makes sure exactly one chip for `r` sits next to the repo title. Returns the
 * chip, or null when the page has no title to attach to. Idempotent: calling it
 * again on an unchanged page does nothing.
 */
export function ensureChip(doc: Document, r: Repo, s: ChipState): HTMLAnchorElement | null {
  const key = `${r.owner}/${r.repo}`.toLowerCase();
  const chips = Array.from(doc.querySelectorAll<HTMLAnchorElement>(`a.${CHIP_CLASS}`));
  const keep = chips.find((c) => c.dataset.holtRepo === key && c.isConnected);
  for (const c of chips) if (c !== keep) c.remove();
  if (keep) return keep;
  const anchor = findAnchor(doc);
  if (!anchor) return null;
  const chip = createChip(doc, r, s);
  if (anchor.where === "append") anchor.el.append(chip);
  else anchor.el.after(chip);
  return chip;
}

export function removeChips(doc: Document): void {
  doc.querySelectorAll(`a.${CHIP_CLASS}`).forEach((c) => c.remove());
}
