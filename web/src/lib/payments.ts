// Pro passes: what the pricing page, the checkout and the thank-you page
// show. No prices live here; they come from the server (API.md, "Passes").
import type { Order, PassFeature } from "./types";

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

/** A pass to buy straight after signing in (`/pricing?buy=pro_3m`), if it's on sale. */
export function passToBuy(buy: unknown, passes: { id: string }[]): string | null {
  return typeof buy === "string" && passes.some((p) => p.id === buy) ? buy : null;
}

/** What one Pro feature gives, in words. */
export function passFeatureLine(f: PassFeature): string {
  if (f.unlimited) return f.name;
  return `${f.name}: ${f.per_month} a month`;
}

/** A pass's price per month, when it's worth saying ("₹83 a month"). */
export function perMonth(amount: number, days: number, currency: string): string | null {
  const months = Math.round(days / 30);
  if (months <= 1) return null;
  return `${formatPrice(Math.round(amount / months / 100) * 100, currency)} a month`;
}
