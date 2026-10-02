// The pricing page's words: what Free holds, and what each Pro feature does
// for the person paying. Prices and Pro's monthly numbers are not here; they
// come from the server (API.md, "Passes").
import type { PassFeature } from "@/lib/types";

/** One line of a plan: its name, and what it does for you. */
export interface PlanItem {
  id: string;
  title: string;
  line: string;
}

/** The free plan's merge plans (`plans.free` in the server's pricing catalogue). */
export const FREE_MERGE_PLANS = 3;

export const FREE: PlanItem[] = [
  { id: "reports", title: "Unlimited reports", line: "Does this repo merge outsiders' pull requests? A verdict, and the PRs behind it." },
  { id: "starter", title: "Starter issues", line: "Open issues in that repo you could pick up first." },
  { id: "find", title: "Find, Discover and Compare", line: "Search by language, browse repos ranked by how they treat outsiders, or put up to four side by side." },
  { id: "badge", title: "Badges and share images", line: "A verdict you can put in a README or post." },
  { id: "normal", title: "“Normal here” on My PRs", line: "Next to each open PR: how long a reply and a merge usually take in that repo." },
  { id: "plans", title: `${FREE_MERGE_PLANS} merge plans`, line: `The same written plans as Pro. You get ${FREE_MERGE_PLANS} in total.` },
];

const PRO: Record<string, Omit<PlanItem, "id">> = {
  pr_watch: {
    title: "PR watch",
    line: "Holt tells you when a maintainer replies and it's your turn, and when a PR has gone quiet for longer than is normal in that repo.",
  },
  repo_watch: { title: "Repo watch", line: "Watch a repo and Holt tells you when its verdict changes." },
  issue_watch: { title: "Issue watch", line: "Holt tells you when a new starter issue opens in a repo you watch, so you get there early." },
  merge_plan: {
    title: "Merge plans",
    line: "A written plan for getting a PR merged in one repo: the steps, what merged PRs there share, and why outside ones get closed. Each claim links to the PRs behind it.",
  },
};

/** The watches first (they are what Pro is), then the merge plan. */
const ORDER = ["pr_watch", "repo_watch", "issue_watch", "merge_plan"];

/**
 * What Pro adds, in reading order. With the server's list (passes on sale),
 * only what it sells, with its monthly numbers; without it, Pro as planned.
 */
export function proItems(features: PassFeature[]): PlanItem[] {
  if (features.length === 0) return ORDER.map((id) => ({ id, ...PRO[id] }));
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return [...features]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((f) => {
      const known = PRO[f.id];
      const title = known?.title ?? f.name;
      return {
        id: f.id,
        title: !f.unlimited && f.per_month ? `${title}, ${f.per_month} a month` : title,
        line: known?.line ?? "",
      };
    });
}
