"use client";

// A monthly plan's subscribe button: start the subscription on the server,
// take the first payment (and the mandate for the next ones) in Razorpay
// Checkout, hand what Checkout returns back to the server, then show the plan
// in Settings. Nothing here starts the plan: the server checks Razorpay's
// signature and asks Razorpay about the subscription first.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RazorpaySubscriptionSuccess, SubscriptionCheckout, SubscriptionConfirmed } from "@/lib/types";
import { loadRazorpay, post } from "./buy-pack";

type Phase =
  | { t: "idle" }
  | { t: "starting" }
  | { t: "paying" }
  | { t: "confirming" }
  | { t: "failed"; message: string }
  | { t: "dismissed" };

export interface SubscribePlanProps {
  plan: string;
  label: string;
  signedIn: boolean;
  prefill?: { name?: string | null; email?: string | null };
  /** Start straight away (back from signing in with `?subscribe=`). */
  autoStart?: boolean;
}

export function SubscribePlan({ plan, label, signedIn, prefill, autoStart }: SubscribePlanProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ t: "idle" });
  const started = useRef(false);

  const confirm = useCallback(
    async (paid: RazorpaySubscriptionSuccess) => {
      setPhase({ t: "confirming" });
      const r = await post<SubscriptionConfirmed>("/api/subscription/confirm", paid);
      if (!r.ok && r.code === "payment_unconfirmed") {
        setPhase({ t: "failed", message: r.message });
        return;
      }
      // Anything else (Razorpay slow, a dropped connection) is finished by
      // Razorpay's webhook; Settings shows the plan once it is.
      router.push("/settings?subscribed=1#plan");
    },
    [router],
  );

  const start = useCallback(async () => {
    setPhase({ t: "starting" });
    const r = await post<SubscriptionCheckout>("/api/subscription", { plan });
    if (!r.ok) {
      setPhase({ t: "failed", message: r.code === "already_subscribed" ? "You already have a plan. Manage it in Settings." : r.message });
      return;
    }
    const sub = r.data;
    try {
      await loadRazorpay();
    } catch {
      setPhase({ t: "failed", message: "Razorpay's payment window didn't load. If you use an ad blocker, allow checkout.razorpay.com and try again." });
      return;
    }
    setPhase({ t: "paying" });
    const rzp = new window.Razorpay!({
      key: sub.key_id,
      subscription_id: sub.provider_subscription_id,
      name: sub.name,
      description: sub.description,
      prefill: { name: prefill?.name ?? undefined, email: prefill?.email ?? undefined },
      notes: { holt_subscription: sub.subscription_id },
      theme: { color: "#15755a" },
      handler: (paid: RazorpaySubscriptionSuccess) => void confirm(paid),
      modal: { ondismiss: () => setPhase((p) => (p.t === "paying" ? { t: "dismissed" } : p)) },
    });
    rzp.on("payment.failed", (e) => setPhase({ t: "failed", message: e.error?.description || "The payment didn't go through. You haven't been charged." }));
    rzp.open();
  }, [plan, prefill, confirm]);

  useEffect(() => {
    if (autoStart && signedIn && !started.current) {
      started.current = true;
      void start();
    }
  }, [autoStart, signedIn, start]);

  const cls = "btn-primary mt-6 w-full";
  if (!signedIn) {
    return (
      <Link href={`/signin?callbackUrl=${encodeURIComponent(`/pricing?subscribe=${plan}`)}`} className={cls}>
        sign in to subscribe →
      </Link>
    );
  }
  const busy = phase.t === "starting" || phase.t === "paying" || phase.t === "confirming";
  return (
    <div>
      <button type="button" className={cls} onClick={() => void start()} disabled={busy} aria-busy={busy}>
        {phase.t === "starting" ? "opening checkout…" : phase.t === "paying" ? "paying in Razorpay…" : phase.t === "confirming" ? "starting your plan…" : label}
      </button>
      <p aria-live="polite" className="mt-3 min-h-[1.25rem] font-sans text-[0.85rem]">
        {phase.t === "failed" && <span role="alert" className="text-orange">{phase.message}</span>}
        {phase.t === "dismissed" && <span className="text-muted">Checkout closed. You haven&apos;t been charged.</span>}
      </p>
    </div>
  );
}
