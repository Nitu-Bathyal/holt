// Credit packs: what the pricing page, the checkout and the thank-you page
// show. No prices live here; they come from the server (API.md, "Credit packs").
import { shortDate } from "./format.ts";
import type { Order, Pack, PlanOffer, Subscription } from "./types";

/** 49900 INR (paise) -> "₹499"; 49950 -> "₹499.50". */
export function formatPrice(amount: number, currency: string): string {
  const major = amount / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

export function creditsLabel(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

/** How long a pack's credits last, in words. */
export function expiryLine(pack: Pick<Pack, "expires_days">): string {
  const d = pack.expires_days;
  if (!d) return "Credits never expire";
  if (d % 365 === 0) return `Credits last ${d / 365} year${d === 365 ? "" : "s"}`;
  if (d % 30 === 0) return `Credits last ${d / 30} month${d === 30 ? "" : "s"}`;
  return `Credits last ${d} days`;
}

/** Our order ids: 32 hex characters. */
export function isOrderId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
}

export const STATUS_LABEL: Record<Order["status"], string> = {
  created: "Waiting for payment",
  paid: "Paid",
  failed: "Didn't go through",
  held: "Being checked",
};

/** A pack or plan to buy straight after signing in (`/pricing?buy=credits_10`), if it's on sale. */
export function packToBuy(buy: unknown, packs: { id: string }[]): string | null {
  return typeof buy === "string" && packs.some((p) => p.id === buy) ? buy : null;
}

/** What one feature of a monthly plan gives, in words. */
export function planFeatureLine(f: PlanOffer["features"][number]): string {
  if (f.unlimited) return `${f.name}, unlimited`;
  return `${f.name}, ${f.per_month} a month`;
}

/** Short label for a subscription's state, for the settings page. */
export function subscriptionLabel(sub: Subscription): string {
  if (sub.status === "active" && sub.cancel_at_period_end) return "Cancelled";
  return SUBSCRIPTION_LABEL[sub.status];
}

const SUBSCRIPTION_LABEL: Record<Subscription["status"], string> = {
  created: "Waiting for payment",
  authenticated: "Starting",
  active: "Active",
  pending: "Payment failed",
  halted: "Stopped",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Ended",
  expired: "Never started",
};

/**
 * One sentence on where a subscription stands: when it charges next, or
 * until when the plan lasts. `planUntil` is when the plan in force lapses.
 */
export function subscriptionLine(sub: Subscription, planUntil: string | null): string {
  const price = formatPrice(sub.amount, sub.currency);
  const paid = sub.paid_until ? shortDate(sub.paid_until) : "";
  const until = planUntil ? shortDate(planUntil) : paid;
  const lasts = planUntil && new Date(planUntil).getTime() > Date.now();
  switch (sub.status) {
    case "active":
      if (sub.cancel_at_period_end) return `You won't be charged again. Your plan stays until ${paid}.`;
      return sub.next_charge_at ? `Next charge: ${price} on ${shortDate(sub.next_charge_at)}.` : `Paid until ${paid}.`;
    case "created":
    case "authenticated":
      return "We're confirming your first payment with Razorpay. This takes a minute or two.";
    case "pending":
      return `Your last payment didn't go through. Razorpay will try again, and your plan keeps working until ${until}.`;
    case "halted":
      return "The payments didn't go through, so the plan stopped. Nothing more will be charged.";
    case "paused":
      return "Paused. Nothing is charged while it's paused.";
    case "cancelled":
    case "completed":
      return lasts ? `No more charges. Your plan stays until ${until}.` : "No more charges. You're on the free plan.";
    case "expired":
      return "The first payment didn't go through, so the plan never started. You haven't been charged.";
  }
}

/** Whether settings should offer "cancel" for this subscription. */
export function canCancel(sub: Subscription): boolean {
  return (sub.status === "active" && !sub.cancel_at_period_end) || sub.status === "authenticated" || sub.status === "pending";
}
