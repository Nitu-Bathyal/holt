import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { claimCredit, me, orders, passes } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { formatPrice, STATUS_LABEL } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { AI_SETTINGS } from "@/lib/settings";
import { WELCOME_AI_CREDITS } from "@/lib/site";
import { NewCount } from "@/components/motion/count-up";
import { Block, Notice, SectionHead } from "@/components/settings/section-head";

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

export default async function AiReportSettings({ searchParams }: PageProps<"/settings/ai-reports">) {
  const user = await currentUser();
  if (!user) redirect(`/signin?callbackUrl=${AI_SETTINGS}`);
  const sp = await searchParams;
  const [account, bought, sale] = await Promise.all([me(user.id), orders(user.id), passes()]);
  const m = account.ok ? account.data : null;
  const purchases = bought.ok ? bought.data.orders : [];
  const onSale = sale.ok && sale.data.on_sale;
  const c = m?.credits;
  const nextClaim = c?.next_claim_at ? shortDate(c.next_claim_at) : "";

  const notice: { tone: "good" | "bad"; text: string } | null =
    sp.claimed ? { tone: "good", text: "Claimed. One more free AI report is yours." }
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
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
          <div className="bg-panel p-5">
            <p className="text-[0.87rem] text-faint">{c.purchased > 0 ? "Credits left" : "Free AI reports left"}</p>
            <p className="mt-1 text-[1.3rem] font-semibold leading-tight"><NewCount id={`credits:${user.id}`} value={c.balance} /></p>
            {c.purchased > 0 && <p className="mt-1 text-[0.87rem] text-muted">{c.free} free, {c.purchased} bought</p>}
          </div>
          <div className="bg-panel p-5">
            <p className="text-[0.87rem] text-faint">This week&apos;s free one</p>
            {c.can_claim ? (
              <form action={claim} className="mt-2">
                <button type="submit" className="btn-primary">claim 1 free AI report</button>
              </form>
            ) : (
              <>
                <p className="mt-1 text-[1.3rem] font-semibold leading-tight">{nextClaim || "soon"}</p>
                <p className="mt-1 text-[0.87rem] text-muted">when you can claim the next one</p>
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

      <Block id="plan" title="Your plan" className="mt-8">
        <p className="prose-sans text-[0.95rem]">
          {m?.plan === "pro" ? (
            <>Pro{m.plan_expires_at && <>, until {shortDate(m.plan_expires_at)}</>}.</>
          ) : (
            <>Free. <Link href="/pricing" className="text-green transition-opacity hover:opacity-75">See pricing</Link>.</>
          )}
        </p>
      </Block>

      {(purchases.length > 0 || onSale) && (
        <Block id="purchases" title="Purchases" className="mt-8">
          {purchases.length === 0 ? (
            <p className="prose-sans text-[0.95rem]">
              Nothing bought yet. <Link href="/pricing#passes" className="text-green transition-opacity hover:opacity-75">See Pro passes</Link>.
            </p>
          ) : (
            <ul className="divide-y divide-line border-b border-line">
              {purchases.map((o) => (
                <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[0.9rem]">
                  <span className="min-w-0">
                    <span className="font-semibold">{o.name}</span>
                    <span className="text-muted"> · {formatPrice(o.amount, o.currency)} · {shortDate(o.paid_at ?? o.created_at)}</span>
                  </span>
                  <span className={o.status === "paid" ? "text-green" : o.status === "held" ? "text-amber" : "text-muted"}>
                    {STATUS_LABEL[o.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {onSale && purchases.length > 0 && (
            <p className="mt-4 text-[0.89rem]"><Link href="/pricing#passes" className="text-green transition-opacity hover:opacity-75">add another pass →</Link></p>
          )}
        </Block>
      )}
    </section>
  );
}
