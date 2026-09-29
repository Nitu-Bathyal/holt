// The slot for a contribution-history view (another worker is exploring one).
// It sits between the page's numbers and its groups; until that lands it
// renders nothing. It gets the whole Contributions answer, counted or not.
import type { Contributions } from "@/lib/types";

export function ContributionHistorySlot(props: { data: Contributions }) {
  void props;
  return null;
}
