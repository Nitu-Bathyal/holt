// What the AI tab offers around the merge plan, from the server's answer
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
