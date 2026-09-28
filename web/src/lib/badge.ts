// The README badge for maintainers: the snippets to paste, and, for a repo
// that doesn't pass yet, what would change that. No imports beyond types, so
// it runs under `node --test`.
import type { Report } from "./types";

/** Only a passing repo is offered a badge (the badge itself says why: a positive line, or "see report"). */
export function badgeOffered(report: Pick<Report, "verdict">): boolean {
  return report.verdict === "viable";
}

export function badgeSnippets(site: string, repo: string): { markdown: string; html: string } {
  const img = `${site}/badge/${repo}.svg`;
  const page = `${site}/${repo}`;
  return {
    markdown: `[![Holt](${img})](${page})`,
    html: `<a href="${page}"><img src="${img}" alt="Holt"></a>`,
  };
}

// Keyed by the rule that decided the verdict (the last of `rule_codes`).
// Advice only: the verdict and its reasons come from the server.
const ADVICE: Record<string, string[]> = {
  archived: ["Archived repos don't get a badge. Unarchive it if you want outside help again."],
  closed_kind: ["This looks like a mirror of a project developed somewhere else. Put the badge on the repo where PRs get reviewed."],
  non_software_kind: ["Holt rates projects where outside contributors change code or docs. Lists, personal forks and sign-up repos don't get a badge."],
  no_attempts: [
    "Nobody outside the team opened a PR recently, so there's nothing to judge.",
    "Label a few small issues \"good first issue\" and link a CONTRIBUTING file from your README, then check again once people have tried.",
  ],
  too_few_attempts: [
    "Too few outside PRs to call it either way.",
    "Label a few small issues \"good first issue\" and check again once more people have tried.",
  ],
  awaiting_reply: ["Some newcomer PRs are too new to judge. Reply to them and check again in a day or two."],
  ignored: [
    "Reply to pull requests from newcomers, even with a short \"thanks, we'll look at this soon\". A first reply is what Holt looks for most.",
    "Merge or close the ones waiting, with a sentence on why, so newcomers know where they stand.",
  ],
  slow: [
    "Newcomers wait too long for a first reply. A quick acknowledgement counts, even before a full review.",
    "A CODEOWNERS file or a triage rota makes sure new PRs get seen.",
  ],
  long_odds: [
    "Very few outside PRs get merged. Say in CONTRIBUTING what kind of change you'd accept, and label issues you'd welcome help with.",
    "Close PRs you won't take with a short reason, so newcomers learn what would land.",
  ],
  rubber_stamp: ["Merged PRs rarely get a review comment. Leave a short review on newcomer PRs so they learn something."],
};

const GENERIC = [
  "Reply to newcomer PRs quickly, review them, and merge the ones that are ready.",
  "Holt checks again every day while the badge is in use.",
];

export function whatWouldChangeIt(report: Pick<Report, "verdict" | "rule_codes">): string[] {
  if (badgeOffered(report)) return [];
  const code = report.rule_codes?.at(-1);
  return (code && ADVICE[code]) || GENERIC;
}
