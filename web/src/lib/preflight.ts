// PR pre-flight: the words and small rules the /preflight page uses. Pure, so
// it can be tested without React. The checks and their verdicts come from the
// server (API.md, PR pre-flight); nothing here decides one.
import type { Access, Preflight, PreflightFor, PreflightVerdict } from "./types";

export const VERDICT_WORDS: Record<PreflightVerdict, string> = {
  ok: "Looks fine",
  worth_fixing: "Worth fixing",
  unknown: "Can't tell yet",
};

/** Worth fixing first, then can't tell, then fine: the order a contributor acts in. */
export const VERDICT_ORDER: PreflightVerdict[] = ["worth_fixing", "unknown", "ok"];

/** "2 worth fixing · 1 can't tell yet · 4 look fine", leaving out zeros. */
export function countsLine(counts: Preflight["counts"]): string {
  const parts: string[] = [];
  if (counts.worth_fixing) parts.push(`${counts.worth_fixing} worth fixing`);
  if (counts.unknown) parts.push(`${counts.unknown} can't tell yet`);
  if (counts.ok) parts.push(`${counts.ok} ${counts.ok === 1 ? "looks" : "look"} fine`);
  return parts.join(" · ");
}

const PR_URL = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com|githolt\.com)\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pulls?\/(\d{1,9})(?:[/?#].*)?$/i;
const PR_SHORT = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})#(\d{1,9})$/;

/** `{repo, number}` for a pull request link or `owner/repo#12`, else null. The server checks again. */
export function parsePrLink(raw: string): { repo: string; number: number } | null {
  const text = raw.trim();
  const m = PR_URL.exec(text) ?? PR_SHORT.exec(text);
  if (!m || Number(m[3]) < 1) return null;
  return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
}

/** The page URL for a target, so a reload (or a shared link) shows the same check. */
export function preflightHref(t: { pr?: string | null; repo?: string | null; branch?: string | null; base?: string | null }): string {
  const q = new URLSearchParams();
  if (t.pr) q.set("pr", t.pr);
  else {
    if (t.repo) q.set("repo", t.repo);
    if (t.branch) q.set("branch", t.branch);
    if (t.base) q.set("base", t.base);
  }
  const s = q.toString();
  return s ? `/preflight?${s}` : "/preflight";
}

/** "pallets/click #3878" or "pallets/click, branch me:fix" for headings. */
export function targetLabel(t: PreflightFor): string {
  if (t.number != null) return `${t.repo} #${t.number}`;
  return `${t.repo}, branch ${t.branch}${t.base ? ` (compared with ${t.base})` : ""}`;
}

/** Links go to GitHub only; anything else is dropped. */
export function isGitHubLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "github.com";
  } catch {
    return false;
  }
}

/** "#3876" for a pull request or issue link, else the file name ("CONTRIBUTING.md"). */
export function linkLabel(url: string): string {
  const m = /\/(?:pull|issues)\/(\d+)/.exec(url);
  if (m) return `#${m[1]}`;
  const path = new URL(url).pathname.split("/").filter(Boolean);
  return path[path.length - 1] ?? "link";
}

/** Text with Markdown code spans: [text, isCode] pieces, in order. */
export function codeSpans(text: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  text.split(/(`[^`\n]+`)/).forEach((piece) => {
    if (!piece) return;
    const code = piece.length > 2 && piece.startsWith("`") && piece.endsWith("`");
    out.push(code ? [piece.slice(1, -1), true] : [piece, false]);
  });
  return out;
}

export type CheckOffer =
  | { kind: "sign-in" }
  | { kind: "can-check"; note: string }
  | { kind: "coming-soon"; note: string }
  | { kind: "blocked"; note: string; buy: boolean };

const creditsWord = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
const SAFE = "A check that fails costs nothing, and checking the same commit again is free.";

/**
 * What the check button can promise, from the server's entitlement answer.
 * While nothing is on sale, a user who can't pay is told it's coming, not
 * sent to buy something that doesn't exist.
 */
export function checkOffer(access: Access | null, onSale: boolean): CheckOffer {
  if (!access) return { kind: "sign-in" };
  if (access.allowed) {
    if (access.via === "plan") {
      const left = access.left_this_month == null ? "" : ` (${access.left_this_month} left this month)`;
      return { kind: "can-check", note: `Included in your plan${left}. ${SAFE}` };
    }
    return { kind: "can-check", note: `Uses ${creditsWord(access.cost)}. ${SAFE}` };
  }
  if (!onSale) {
    const price = access.cost > 0 ? ` It will cost ${creditsWord(access.cost)} per check.` : "";
    return { kind: "coming-soon", note: `Coming soon: pre-flight checks aren't on sale yet.${price}` };
  }
  return { kind: "blocked", note: access.message ?? "You can't run a check right now.", buy: true };
}

/** "+54 −1 · 4 files", or "" when GitHub didn't say. */
export function sizeLine(t: Preflight["target"]): string {
  const parts: string[] = [];
  if (t.additions != null && t.deletions != null) parts.push(`+${t.additions} −${t.deletions}`);
  else if (t.lines != null) parts.push(`${t.lines} lines`);
  if (t.files != null) parts.push(`${t.files} ${t.files === 1 ? "file" : "files"}`);
  return parts.join(" · ");
}
