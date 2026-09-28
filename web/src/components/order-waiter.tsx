"use client";

// On the thank-you page while a payment is still being confirmed: ask every
// few seconds whether the order has settled, then re-render the page.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";

const EVERY_MS = 2500;
const FOR_MS = 60_000;

export function OrderWaiter({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t0 = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (Date.now() - t0 > FOR_MS) {
        setSlow(true);
        return;
      }
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { orders?: Order[] } | null;
        if (body?.orders?.some((o) => o.id === orderId)) {
          router.refresh();
          return;
        }
      } catch {
        // keep asking
      }
      setTimeout(tick, EVERY_MS);
    };
    const first = setTimeout(tick, EVERY_MS);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [orderId, router]);

  return slow ? (
    <p className="prose-sans mt-4 text-[1rem]">
      This is taking longer than usual. You can leave this page: your credits will appear in Settings as soon as Razorpay confirms the
      payment. If it doesn&apos;t go through, you won&apos;t be charged.
    </p>
  ) : (
    <p className="mt-4 flex items-center gap-2 text-[0.875rem] text-muted" role="status">
      <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber" /> Waiting for Razorpay to confirm…
    </p>
  );
}
