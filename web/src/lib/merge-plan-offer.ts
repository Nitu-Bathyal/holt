// What the merge plan page offers around the plan, from the server's answer
// (API.md, Merge plan). Pure, so it can be tested without React.
import type { MergePlanState } from "./types";

export type PlanOffer =
  | { kind: "off" }
  | { kind: "make"; left: number | null }
  | { kind: "locked"; message: string };

/**
 * Off: merge plans can't be made here (no paid features, or AI switched off).
 * Make: this user can have one made now (`left` of their allowance).
 * Locked: they can't; the server's message says why.
 */
export function planOffer(s: Pick<MergePlanState, "available" | "access">): PlanOffer {
  if (!s.available || !s.access) return { kind: "off" };
  if (s.access.allowed) return { kind: "make", left: s.access.left ?? null };
  return { kind: "locked", message: s.access.message ?? "You've used your free merge plans." };
}

/** "3 left", "1 left", or nothing when the allowance is unlimited. */
export function leftLabel(left: number | null): string | null {
  return left == null ? null : `${left} left`;
}

const REFUNDED = "It didn't count against your merge plans.";

/**
 * What a person reads when a plan being made failed. Every failed job gives
 * its use back; the server's own messages say so, and the job runner's
 * general ones (a timeout, a crash) get the same line here.
 */
export function failedMessage(message: string): string {
  const text = message.trim();
  if (/count against|weren't charged|nothing was charged/i.test(text)) return text;
  return `${text} ${REFUNDED}`.trim();
}
