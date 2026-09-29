// "How to get merged here": the words and small rules the playbook section
// uses. Pure, so it can be tested without React.
import type { Access, PlaybookSectionKey, PlaybookSource, PlaybookState } from "./types";

export const SECTION_TITLES: Record<PlaybookSectionKey, string> = {
  must_do: "What merged pull requests do",
  size_and_scope: "Size and scope",
  reviewers: "Who reviews",
  closing_reasons: "Why outside pull requests were closed",
  checklist: "Before you open your pull request",
};

export const SECTION_ORDER = Object.keys(SECTION_TITLES) as PlaybookSectionKey[];

/**
 * Whether a report page shows the playbook at all. While playbooks aren't on
 * sale it stays hidden, except for someone who already has one, has one
 * being written, or can unlock one anyway.
 */
export function showPlaybook<T extends Pick<PlaybookState, "available" | "on_sale" | "access" | "playbook" | "job">>(s: T | null): s is T {
  if (!s?.available) return false;
  return s.on_sale || Boolean(s.playbook || s.job || s.access?.allowed);
}

/** "seen in 34 of 44 pull requests", or null for a fact from a document. */
export function seenLabel(s: Pick<PlaybookSource, "seen" | "of">, what = "pull requests"): string | null {
  if (s.seen == null || s.of == null) return null;
  return `seen in ${s.seen} of ${s.of} ${what}`;
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

export type UnlockOffer =
  | { kind: "sign-in" }
  | { kind: "can-unlock"; note: string }
  | { kind: "coming-soon"; note: string }
  | { kind: "blocked"; note: string };

const creditsWord = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

/**
 * What the unlock button can promise, from the server's entitlement answer.
 * Nothing is on sale yet, so a user who can't pay is told it's coming, not
 * sent to buy something that doesn't exist.
 */
export function unlockOffer(access: Access | null, onSale: boolean): UnlockOffer {
  if (!access) return { kind: "sign-in" };
  if (access.allowed) {
    if (access.via === "plan") {
      const left = access.left_this_month == null ? "" : ` (${access.left_this_month} left this month)`;
      return { kind: "can-unlock", note: `Included in your plan${left}. A playbook that fails costs nothing.` };
    }
    return { kind: "can-unlock", note: `Uses ${creditsWord(access.cost)}. A playbook that fails costs nothing.` };
  }
  if (!onSale) {
    const price = access.cost > 0 ? ` It will cost ${creditsWord(access.cost)} per repository.` : "";
    return { kind: "coming-soon", note: `Coming soon: playbooks aren't on sale yet.${price}` };
  }
  return { kind: "blocked", note: access.message ?? "You can't unlock this playbook right now." };
}
