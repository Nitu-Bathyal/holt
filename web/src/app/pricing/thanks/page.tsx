import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { me, orders } from "@/lib/api";
import { creditsLabel, formatPrice, isOrderId } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { CONTACT_EMAIL } from "@/lib/site";
import { OrderWaiter } from "@/components/order-waiter";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Thank you", robots: { index: false } };

// After a credit-pack checkout: paid (thank you), still being confirmed (wait
// here), declined, or held for a person to check. Only the buyer's own orders.
export default async function ThanksPage({ searchParams }: PageProps<"/pricing/thanks">) {
  const sp = await searchParams;
  const id = isOrderId(sp.order) ? sp.order : null;
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(id ? `/pricing/thanks?order=${id}` : "/settings")}`);
  if (!id) redirect("/settings#purchases");

  const [list, account] = await Promise.all([orders(user.id), me(user.id)]);
  const order = list.ok ? list.data.orders.find((o) => o.id === id) : undefined;
  const credits = account.ok ? account.data.credits : null;

  let heading: React.ReactNode;
  let body: React.ReactNode;
  if (order?.status === "paid") {
    heading = <>Thank you. <span className="text-green">{creditsLabel(order.credits)} added.</span></>;
    body = (
      <>
        <p className="prose-sans text-[1.05rem]">
          You paid {formatPrice(order.amount, order.currency)} for {order.name}. Razorpay emails you a receipt.
          {credits && <> You now have <strong className="text-ink">{creditsLabel(credits.balance)}</strong> to spend.</>}
        </p>
        <p className="prose-sans mt-3 text-[0.95rem] text-muted">
          Credits pay for AI reports and paid features, after your free ones are used up. The quick report is always free.
        </p>
      </>
    );
  } else if (order?.status === "failed") {
    heading = <>That payment didn&apos;t go through.</>;
    body = <p className="prose-sans text-[1.05rem]">You haven&apos;t been charged. You can try again with another payment method.</p>;
  } else if (order?.status === "held") {
    heading = <>We&apos;re checking your payment.</>;
    body = (
      <p className="prose-sans text-[1.05rem]">
        Razorpay told us about your payment, but it didn&apos;t match the order, so we haven&apos;t added credits yet. We check these by
        hand. If it isn&apos;t sorted within a day, write to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-link">{CONTACT_EMAIL}</a> and mention order <code className="text-[0.85em]">{id.slice(0, 12)}</code>.
      </p>
    );
  } else {
    heading = <>Almost there.</>;
    body = (
      <>
        <p className="prose-sans text-[1.05rem]">Your payment is being confirmed. This usually takes a few seconds.</p>
        <OrderWaiter orderId={id} />
      </>
    );
  }

  return (
    <PageTransition>
      <>
        <PageHead narrow>
          <p className="rail mb-4 flex gap-2"><strong className="m-0">credits</strong><span>your purchase</span></p>
          <h1 className="display text-[clamp(2rem,6vw,3rem)]">{heading}</h1>
        </PageHead>
        <div className="wrap max-w-3xl pb-14 pt-6 sm:pb-16">
          <section className="border border-line-strong bg-panel p-5 shadow-soft sm:p-8">{body}</section>
          <div className="mt-6 flex flex-wrap gap-3">
            {order?.status === "failed" ? (
              <Link href="/pricing#packs" className="btn-primary">try again →</Link>
            ) : (
              <Link href="/" className="btn-primary">check a repo →</Link>
            )}
            <Link href="/settings#purchases" className="btn-ghost">your purchases</Link>
          </div>
        </div>
      </>
    </PageTransition>
  );
}
