import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatFace } from "@/components/cat-face";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { PickCard } from "@/components/recommendations/pick-card";
import { recommendations } from "@/lib/api";
import { basisLine, emptyReason, excludedLine, lockedLine } from "@/lib/recommendations";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Picked for you", robots: { index: false } };

export default async function ForYouPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/for-you");
  const r = await recommendations(user.id);
  const d = r.ok ? r.data : null;
  const basis = d ? basisLine(d.basis) : null;
  const excluded = d ? excludedLine(d.basis.already_contributing) : null;

  return (
    <PageTransition>
      <>
      <PageHead narrow>
        <p className="rail mb-4 flex gap-2">
          <strong className="m-0">for you</strong>
          <span>{user.name || user.email}</span>
        </p>
        <h1 className="display text-[clamp(2rem,6vw,3rem)]">Picked for you</h1>
        <p className="prose-sans mt-3 max-w-xl text-muted">
          Repos Holt rates <span className="text-green">Worth your time</span>, where maintainers are replying right now, matched to
          what you told us and what you&apos;ve done on GitHub. Ranked by fixed rules, never by AI.
        </p>
      </PageHead>
      <div className="wrap max-w-3xl pb-14 pt-2 sm:pb-16">
        {!r.ok ? (
          <div className="mt-8"><ErrorPanel error={r.error} retryHref="/for-you" /></div>
        ) : d && d.picks.length === 0 ? (
          <div className="mt-8 border border-dashed border-line-strong p-8 text-center">
            <CatFace mood="thinking" className="text-[1.6rem]" />
            {emptyReason(d.basis) === "nothing-to-match" ? (
              <>
                <p className="prose-sans mx-auto mt-4 max-w-md text-muted">
                  Tell Holt which languages and topics you like, or connect GitHub so it can see where your pull requests got merged.
                  Then this page fills with repos worth your time.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/settings#profile" className="btn-primary inline-flex">set up your profile</Link>
                  {!d.basis.connected && <Link href="/connect" className="bracket-link">[ connect GitHub ]</Link>}
                </div>
              </>
            ) : (
              <>
                <p className="prose-sans mx-auto mt-4 max-w-md text-muted">
                  Nothing fits right now: no repo Holt has checked recently matches your languages and topics, is worth your time, and
                  has maintainers replying. Try more languages or topics, or browse the boards.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/discover" className="btn-primary inline-flex">browse welcoming repos</Link>
                  <Link href="/settings#profile" className="bracket-link">[ edit your profile ]</Link>
                </div>
              </>
            )}
          </div>
        ) : d && (
          <>
            {(basis || excluded) && (
              <p className="mt-6 font-sans text-[0.88rem] text-muted">
                {basis} {excluded} <Link href="/settings#profile" className="text-link">Edit your profile</Link>
              </p>
            )}
            <ol className="mt-6 space-y-4">
              {d.picks.map((p, i) => (
                <PickCard key={p.repo} p={p} rank={i + 1} />
              ))}
            </ol>
            {d.locked > 0 && (
              <div className="mt-6 border border-blue/50 bg-blue/[0.06] p-5 sm:p-6">
                <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">Holt Pro</p>
                <h2 className="mt-1 text-[1.15rem] font-semibold tracking-tight">{lockedLine(d.locked)}</h2>
                <p className="mt-2 font-sans text-[0.92rem] text-muted">
                  The full list, refreshed every day, comes with Holt Pro. Pro isn&apos;t on sale yet; these two picks are free.
                </p>
                <Link href="/pricing" className="mt-4 inline-block text-[0.85rem] text-blue hover:underline">[ see plans ]</Link>
              </div>
            )}
            <p className="mt-6 font-sans text-[0.8rem] text-faint">
              Built from Holt&apos;s latest checks. We look again as repos are re-checked and your pull requests are read, every day.
              Repos you already contribute to, archived repos and forks are left out.
            </p>
          </>
        )}
      </div>
      </>
    </PageTransition>
  );
}
