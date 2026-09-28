import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatFace } from "@/components/cat-face";
import { PrList } from "@/components/contributions/pr-list";
import { RefreshButton } from "@/components/contributions/refresh-button";
import { ErrorPanel } from "@/components/error-panel";
import { AppPageHeader } from "@/components/shell/app-page";
import { PageTransition } from "@/components/motion/page-transition";
import { ForYouCard } from "@/components/recommendations/for-you-card";
import { contributions, recommendations } from "@/lib/api";
import { foundViaHoltLine, landedLine, landedPct } from "@/lib/contributions";
import { timeAgo } from "@/lib/format";
import { outsidePulls } from "@/lib/home";
import { currentUser } from "@/lib/session";
import { refresh } from "./actions";

export const metadata: Metadata = { title: "Your contributions", robots: { index: false } };

const NOTICES: Record<string, { tone: string; text: string }> = {
  done: { tone: "text-green border-green/50 bg-green/10", text: "Updated from GitHub." },
  wait: { tone: "text-muted border-line-strong", text: "Already up to date: we checked GitHub a few minutes ago." },
  limited: { tone: "text-orange border-orange/50 bg-orange/10", text: "GitHub is asking us to slow down. Your list below is from the last check; try again in a few minutes." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't reach GitHub just now. Your list below is from the last check; try again in a minute." },
};

function Tile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="bg-panel p-4 sm:p-5">
      <p className="text-[0.8rem] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="mt-1 text-[1.5rem] font-semibold">{value}</p>
      {note && <p className="mt-1 text-[0.82rem] text-faint">{note}</p>}
    </div>
  );
}

export default async function ContributionsPage({ searchParams }: PageProps<"/me/contributions">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me/contributions");
  const sp = await searchParams;
  const [r, picks] = await Promise.all([contributions(user.id), recommendations(user.id, 2)]);
  const notConnected = !r.ok && r.error.code === "not_found";
  const notice = typeof sp.refresh === "string" ? NOTICES[sp.refresh] : undefined;
  const d = r.ok ? r.data : null;
  const pct = d ? landedPct(d.summary) : null;
  const via = d ? foundViaHoltLine(d.summary.found_via_holt) : null;

  return (
    <PageTransition>
      <>
      <div className="wrap max-w-3xl pb-14 sm:pb-16">
        <AppPageHeader title="Your pull requests" lead={<>Your public PRs to other people&apos;s repos from the last 12 months, with Holt&apos;s verdict on each repo.{d && <span className="text-faint"> As @{d.login}.</span>}</>} />
        {notice && d && <p role="status" className={`mt-6 border px-4 py-3 font-sans text-[0.9rem] ${notice.tone}`}>{notice.text}</p>}

        {notConnected ? (
          <div className="mt-8 border border-dashed border-line-strong p-8 text-center">
            <CatFace mood="thinking" className="text-[1.6rem]" />
            <p className="prose-sans mx-auto mt-4 max-w-md text-muted">
              Connect your GitHub account to see your pull requests here, each with Holt&apos;s verdict on the repo. It&apos;s free, and Holt
              only reads public data.
            </p>
            <Link href="/connect" className="btn-primary mt-6 inline-flex">connect GitHub</Link>
          </div>
        ) : !r.ok ? (
          <div className="mt-8"><ErrorPanel error={r.error} retryHref="/me/contributions" /></div>
        ) : d && (
          <>
            <section aria-label="Summary" className="mt-8 grid grid-cols-2 gap-px border border-line bg-line shadow-soft sm:grid-cols-4">
              <Tile label="Opened" value={String(d.summary.opened)} note={d.truncated ? "your latest 200" : "last 12 months"} />
              <Tile label="Merged" value={String(d.summary.merged)} />
              <Tile label="Still waiting" value={String(d.summary.waiting)} note="open, no decision yet" />
              <Tile label="Landed" value={pct == null ? "–" : `${pct}%`} note={landedLine(d.summary) ?? "nothing decided yet"} />
            </section>
            {via && <p className="prose-sans mt-4 text-[0.9rem] text-blue">{via}</p>}
            {picks.ok && <ForYouCard data={picks.data} />}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[0.82rem] text-faint">
                Checked GitHub <time dateTime={d.fetched_at}>{timeAgo(d.fetched_at)}</time>. We check again every day.
              </p>
              <RefreshButton action={refresh} nextRefreshAt={d.next_refresh_at} />
            </div>

            <div className="mt-4">
              {d.pull_requests.length === 0 ? (
                <div className="border border-dashed border-line-strong p-8 text-center">
                  <CatFace mood="startled" className="text-[1.6rem]" />
                  <p className="prose-sans mx-auto mt-4 max-w-md text-muted">
                    No public pull requests to other people&apos;s repos in the last 12 months. Holt can help you pick a first one.
                  </p>
                  <Link href="/find" className="bracket-link mt-6">[ find a project → ]</Link>
                </div>
              ) : (
                <PrList prs={outsidePulls(d.pull_requests, d.login)} />
              )}
            </div>

            <p className="mt-6 font-sans text-[0.87rem] text-faint">
              &ldquo;Found via Holt&rdquo; marks a pull request you opened within 30 days of checking that repo here while connected.
              The verdict is Holt&apos;s latest check of each repo; no verdict yet means nobody has checked it.
              Pull requests to your own repos are left out. <Link href="/settings/accounts" className="text-link">GitHub settings</Link>
            </p>
          </>
        )}
      </div>
      </>
    </PageTransition>
  );
}
