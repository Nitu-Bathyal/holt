import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cancelSubscription, claimCredit, me, mySubscription, orders, packs, plans } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { canCancel, creditsLabel, formatPrice, STATUS_LABEL, subscriptionLabel, subscriptionLine } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { WELCOME_AI_CREDITS } from "@/lib/site";
import { ConnectGitHubCard } from "@/components/connect-github-card";
import { ProfileCard } from "@/components/profile-card";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

async function claim() {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
  // The server decides whether a claim is due; the button is only a hint.
  const r = await claimCredit(user.id);
  revalidatePath("/settings");
  redirect(r.ok ? "/settings?claimed=1" : r.error.code === "claim_not_ready" ? "/settings?error=early" : "/settings?error=claim");
}

async function cancelPlan() {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
  const r = await cancelSubscription(user.id);
  revalidatePath("/settings");
  redirect(r.ok ? "/settings?cancelled=1#plan" : "/settings?error=cancel#plan");
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
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

  const notice =
    sp.claimed ? { tone: "text-green border-green/50 bg-green/10", text: "Claimed. You have one more free AI report." }
    : sp.subscribed ? { tone: "text-green border-green/50 bg-green/10", text: "Thanks! Your plan is below. It can take a minute to show as active." }
    : sp.cancelled ? { tone: "text-green border-green/50 bg-green/10", text: "Cancelled. You won't be charged again." }
    : sp.error === "cancel" ? { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't cancel just now. Try again in a minute; nothing has changed." }
    : sp.error === "early" ? { tone: "text-orange border-orange/50 bg-orange/10", text: `Not yet: your next free AI report can be claimed on ${nextClaim}.` }
    : sp.error ? { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't claim it just now. Try again in a minute." }
    : null;

  return (
    <PageTransition>
      <>
      <PageHead narrow>
        <p className="rail mb-4 flex gap-2"><strong className="m-0">settings</strong><span>{user.name || user.email}</span></p>
        <h1 className="display text-[clamp(2rem,6vw,3rem)]">Your AI reports</h1>
      </PageHead>
      <div className="wrap max-w-3xl pb-14 pt-2 sm:pb-16">

        {notice && <p role="status" className={`mt-6 border px-4 py-3 font-sans text-[0.9rem] ${notice.tone}`}>{notice.text}</p>}
        {!account.ok && <p role="alert" className="mt-6 border border-orange/50 px-4 py-3 font-sans text-[0.9rem] text-orange">{account.error.message}</p>}

        {m && c && (
          <section aria-labelledby="credits" className="mt-8 grid gap-px border border-line bg-line shadow-soft sm:grid-cols-2">
            <div className="bg-panel p-5">
              <p id="credits" className="text-[0.72rem] uppercase tracking-[0.08em] text-faint">{c.purchased > 0 ? "Credits left" : "Free AI reports left"}</p>
              <p className="mt-1 text-[1.3rem] font-semibold">{c.balance}</p>
              {c.purchased > 0 && <p className="mt-1 text-[0.8rem] text-muted">{c.free} free · {c.purchased} bought</p>}
              <p className="mt-2 text-[0.75rem] text-faint">
                Plan: <span className="capitalize">{m.plan}</span> · <Link href="/pricing" className="text-green hover:underline">see plans →</Link>
              </p>
            </div>
            <div className="bg-panel p-5">
              <p className="text-[0.72rem] uppercase tracking-[0.08em] text-faint">Weekly free report</p>
              {c.can_claim ? (
                <form action={claim} className="mt-2">
                  <button type="submit" className="btn-primary">claim 1 free AI report</button>
                </form>
              ) : (
                <>
                  <p className="mt-1 text-[1.3rem] font-semibold">{nextClaim || "soon"}</p>
                  <p className="mt-2 text-[0.75rem] text-faint">when you can claim the next one</p>
                </>
              )}
            </div>
          </section>
        )}

        {c && !c.ai_available && (
          <p className="mt-6 border border-line-strong px-4 py-3 font-sans text-[0.9rem] text-muted">
            AI reports aren&apos;t switched on yet. Your free reports will be waiting when they are.
          </p>
        )}

        <section aria-labelledby="how" className="mt-10 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
          <h2 id="how" className="text-[1.3rem] font-semibold tracking-tight">How free AI reports work</h2>
          <ul className="prose-sans mt-3 list-disc space-y-1.5 pl-5 text-[0.95rem]">
            <li>You get {WELCOME_AI_CREDITS} when you first sign in.</li>
            <li>
              Every {c?.claim_every_days ?? 7} days you can claim 1 more here. Unclaimed weeks don&apos;t add up, so there&apos;s
              only ever one to claim.
            </li>
            <li>An AI report that fails doesn&apos;t use one up.</li>
            <li>The quick report is always free and has the same verdict. AI only adds a written explanation.</li>
          </ul>
        </section>

        {(sub || charges.length > 0 || plansOnSale) && (
          <section id="plan" aria-labelledby="plan-h" className="mt-10 scroll-mt-24 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
            <h2 id="plan-h" className="text-[1.3rem] font-semibold tracking-tight">Your plan</h2>
            {!sub ? (
              <p className="prose-sans mt-2 text-[0.95rem]">
                You&apos;re on the free plan. <Link href="/pricing#plans" className="text-link">See paid plans</Link>.
              </p>
            ) : (
              <>
                <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[1.1rem] font-semibold">{sub.name}</span>
                  <span className="text-muted">{formatPrice(sub.amount, sub.currency)} a month</span>
                  <span className={`chip ${sub.status === "active" && !sub.cancel_at_period_end ? "border-green/60 text-green" : sub.status === "pending" ? "border-orange/60 text-orange" : "border-line-strong text-muted"}`}>
                    {subscriptionLabel(sub)}
                  </span>
                </p>
                <p className="prose-sans mt-2 text-[0.95rem]">{subscriptionLine(sub, m?.plan_expires_at ?? null)}</p>
                {canCancel(sub) && (
                  <details className="mt-4 font-sans text-[0.9rem]">
                    <summary className="cursor-pointer text-muted hover:text-ink">Cancel plan</summary>
                    <div className="mt-3 border border-line p-4">
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
                <h3 className="mt-6 text-[0.72rem] uppercase tracking-[0.08em] text-faint">Payments</h3>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {charges.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[0.9rem]">
                      <span className="min-w-0">
                        <span className="font-semibold">{formatPrice(c.amount, c.currency)}</span>
                        <span className="text-muted"> · {shortDate(c.paid_at)}</span>
                      </span>
                      <span className={c.status === "paid" ? "text-green" : "text-amber"}>
                        {c.status === "paid"
                          ? c.period_start && c.period_end ? `${shortDate(c.period_start)} to ${shortDate(c.period_end)}` : "Paid"
                          : "Being checked"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {(purchases.length > 0 || onSale) && (
          <section id="purchases" aria-labelledby="purchases-h" className="mt-10 scroll-mt-24 border border-line-strong bg-panel p-5 shadow-soft sm:p-8">
            <h2 id="purchases-h" className="text-[1.3rem] font-semibold tracking-tight">Purchases</h2>
            {purchases.length === 0 ? (
              <p className="prose-sans mt-2 text-[0.95rem]">
                Nothing bought yet. <Link href="/pricing#packs" className="text-link">See credit packs</Link>.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
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
          </section>
        )}

        <ProfileCard userId={user.id} notice={sp.profile} />

        <ConnectGitHubCard userId={user.id} notice={sp.github} />
      </div>
      </>
    </PageTransition>
  );
}
