import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { claimCredit, me } from "@/lib/api";
import { shortDate } from "@/lib/format";
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

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/settings");
  const sp = await searchParams;
  const account = await me(user.id);
  const m = account.ok ? account.data : null;
  const c = m?.credits;
  const nextClaim = c?.next_claim_at ? shortDate(c.next_claim_at) : "";

  const notice =
    sp.claimed ? { tone: "text-green border-green/50 bg-green/10", text: "Claimed. You have one more free AI report." }
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
              <p id="credits" className="text-[0.72rem] uppercase tracking-[0.08em] text-faint">Free AI reports left</p>
              <p className="mt-1 text-[1.3rem] font-semibold">{c.balance}</p>
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

        <ProfileCard userId={user.id} notice={sp.profile} />

        <ConnectGitHubCard userId={user.id} notice={sp.github} />
      </div>
      </>
    </PageTransition>
  );
}
