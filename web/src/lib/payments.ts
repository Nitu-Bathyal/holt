// Credit packs: what the pricing page, the checkout and the thank-you page
// show. No prices live here; they come from the server (API.md, "Credit packs").
import type { Order, Pack } from "./types";

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

/** A pack to buy straight after signing in (`/pricing?buy=credits_10`), if it's on sale. */
export function packToBuy(buy: unknown, packs: Pack[]): string | null {
  return typeof buy === "string" && packs.some((p) => p.id === buy) ? buy : null;
}
