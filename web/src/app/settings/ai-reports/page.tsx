import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cancelSubscription, claimCredit, me, mySubscription, orders, packs, plans } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { canCancel, creditsLabel, formatPrice, STATUS_LABEL, subscriptionLabel, subscriptionLine } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { AI_SETTINGS } from "@/lib/settings";
import { WELCOME_AI_CREDITS } from "@/lib/site";
import { Notice, SectionHead } from "@/components/settings/section-head";

export const metadata: Metadata = { title: "AI reports and plan · Settings", robots: { index: false } };

async function claim() {
  "use server";
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${AI_SETTINGS}`);
  // The server decides whether a claim is due; the button is only a hint.
  const r = await claimCredit(user.id);
  revalidatePath("/settings", "layout");
  redirect(r.ok ? `${AI_SETTINGS}?claimed=1` : r.error.code === "claim_not_ready" ? `${AI_SETTINGS}?error=early` : `${AI_SETTINGS}?error=claim`);
}

async function cancelPlan() {
  "use server";
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${AI_SETTINGS}`);
  const r = await cancelSubscription(user.id);
  revalidatePath("/settings", "layout");
  redirect(r.ok ? `${AI_SETTINGS}?cancelled=1#plan` : `${AI_SETTINGS}?error=cancel#plan`);
}

const H3 = "text-[1.1rem] font-semibold tracking-tight";

export default async function AiReportSettings({ searchParams }: PageProps<"/settings/ai-reports">) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${AI_SETTINGS}`);
  const sp = await searchParams;
  const [account, bought, sale, subscription, monthly] = await Promise.all([
    me(user.id), orders(user.id), packs(), mySubscription(user.id), plans(),
  ]);
  const m = account.ok ? account.data : null;
  const sub = subscription.ok ? subscription.data.subscription : null;
  const charges = subscription.ok ? subscription.data.charges : [];
  const plansOnSale = monthly.ok && monthly.data.on_sale;
  const purchases = bought.ok ? bought.data.orders : [];
  const onSale = sale.ok && sale.data.on_sale;
  const c = m?.credits;
  const nextClaim = c?.next_claim_at ? shortDate(c.next_claim_at) : "";

  const notice: { tone: "good" | "bad"; text: string } | null =
    sp.claimed ? { tone: "good", text: "Claimed. One more free AI report is yours." }
    : sp.subscribed ? { tone: "good", text: "Thanks! Your plan is below. It can take a minute to go active." }
    : sp.cancelled ? { tone: "good", text: "Cancelled. You won't be charged again." }
    : sp.error === "cancel" ? { tone: "bad", text: "That didn't cancel, and nothing changed. Try again in a minute." }
    : sp.error === "early" ? { tone: "bad", text: `Not yet. Your next free AI report is ready on ${nextClaim}.` }
    : sp.error ? { tone: "bad", text: "That didn't go through. Try again in a minute." }
    : null;

  return (
    <section aria-labelledby="ai-reports-h">
      <SectionHead id="ai-reports">
        <p>Every report&apos;s verdict is free. An AI report adds a written explanation on top.</p>
      </SectionHead>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!account.ok && <p role="alert" className="mb-6 border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{account.error.message}</p>}

      {m && c && (
        <div className="grid gap-px border border-line bg-line shadow-soft sm:grid-cols-2">
          <div className="bg-panel p-5">
            <p className="text-[0.8rem] text-faint">{c.purchased > 0 ? "Credits left" : "Free AI reports left"}</p>
            <p className="mt-1 text-[1.6rem] font-semibold leading-tight">{c.balance}</p>
            {c.purchased > 0 && <p className="mt-1 text-[0.8rem] text-muted">{c.free} free, {c.purchased} bought</p>}
          </div>
          <div className="bg-panel p-5">
            <p className="text-[0.8rem] text-faint">This week&apos;s free one</p>
            {c.can_claim ? (
              <form action={claim} className="mt-2">
                <button type="submit" className="btn-primary">claim 1 free AI report</button>
              </form>
            ) : (
              <>
                <p className="mt-1 text-[1.6rem] font-semibold leading-tight">{nextClaim || "soon"}</p>
                <p className="mt-1 text-[0.8rem] text-muted">when you can claim the next one</p>
              </>
            )}
          </div>
        </div>
      )}

      {c && !c.ai_available && (
        <p className="mt-4 border border-line-strong px-4 py-3 font-sans text-[0.9rem] text-muted">
          AI reports aren&apos;t switched on yet. Your free reports will be waiting when they are.
        </p>
      )}

      <details className="mt-4 font-sans text-[0.9rem]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted hover:text-ink">How free AI reports work</summary>
        <ul className="prose-sans list-disc space-y-1 pb-2 pl-5 text-[0.9rem]">
          <li>You get {WELCOME_AI_CREDITS} when you first sign in.</li>
          <li>Claim 1 more here every {c?.claim_every_days ?? 7} days. Missed weeks don&apos;t stack.</li>
          <li>A failed AI report doesn&apos;t use one up.</li>
        </ul>
      </details>

      <div id="plan" className="mt-8 scroll-mt-24 border-t border-line pt-6">
        <h3 className={H3}>Your plan</h3>
        {!sub ? (
          <p className="prose-sans mt-2 text-[0.95rem]">
            Free.{" "}
            {plansOnSale ? <Link href="/pricing#plans" className="text-link">See paid plans</Link> : <Link href="/pricing" className="text-link">See pricing</Link>}.
          </p>
        ) : (
          <>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[1.05rem] font-semibold">{sub.name}</span>
              <span className="text-muted">{formatPrice(sub.amount, sub.currency)} a month</span>
              <span className={`chip ${sub.status === "active" && !sub.cancel_at_period_end ? "border-green/60 text-green" : sub.status === "pending" ? "border-orange/60 text-orange" : "border-line-strong text-muted"}`}>
                {subscriptionLabel(sub)}
              </span>
            </p>
            <p className="prose-sans mt-2 text-[0.95rem]">{subscriptionLine(sub, m?.plan_expires_at ?? null)}</p>
            {canCancel(sub) && (
              <details className="mt-4 font-sans text-[0.9rem]">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted hover:text-ink">Cancel plan</summary>
                <div className="mt-1 border border-line p-4">
                  <p>
                    {sub.status === "active"
                      ? `You won't be charged again, and you keep the plan until ${sub.paid_until ? shortDate(sub.paid_until) : "the end of this month"}.`
                      : "The plan stops now and nothing more is charged."}
                  </p>
                  <form action={cancelPlan} className="mt-3">
                    <button type="submit" className="btn-ghost">yes, cancel my plan</button>
                  </form>
                </div>
              </details>
            )}
          </>
        )}
        {charges.length > 0 && (
          <>
            <h4 className="mt-6 text-[0.85rem] text-faint">Payments</h4>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {charges.map((ch) => (
                <li key={ch.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[0.9rem]">
                  <span className="min-w-0">
                    <span className="font-semibold">{formatPrice(ch.amount, ch.currency)}</span>
                    <span className="text-muted"> · {shortDate(ch.paid_at)}</span>
                  </span>
                  <span className={ch.status === "paid" ? "text-green" : "text-amber"}>
                    {ch.status === "paid"
                      ? ch.period_start && ch.period_end ? `${shortDate(ch.period_start)} to ${shortDate(ch.period_end)}` : "Paid"
                      : "Being checked"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {(purchases.length > 0 || onSale) && (
        <div id="purchases" className="mt-8 scroll-mt-24 border-t border-line pt-6">
          <h3 className={H3}>Purchases</h3>
          {purchases.length === 0 ? (
            <p className="prose-sans mt-2 text-[0.95rem]">
              Nothing bought yet. <Link href="/pricing#packs" className="text-link">See credit packs</Link>.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {purchases.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[0.9rem]">
                  <span className="min-w-0">
                    <span className="font-semibold">{o.name}</span>
                    <span className="text-muted"> · {formatPrice(o.amount, o.currency)} · {shortDate(o.paid_at ?? o.created_at)}</span>
                  </span>
                  <span className={o.status === "paid" ? "text-green" : o.status === "held" ? "text-amber" : "text-muted"}>
                    {o.status === "paid" ? `${creditsLabel(o.credits)} added` : STATUS_LABEL[o.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {onSale && purchases.length > 0 && (
            <p className="mt-4 text-[0.85rem]"><Link href="/pricing#packs" className="text-link">Buy more credits →</Link></p>
          )}
        </div>
      )}
    </section>
  );
}
