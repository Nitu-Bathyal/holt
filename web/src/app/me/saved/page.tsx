import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatFace } from "@/components/cat-face";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader } from "@/components/shell/app-page";
import { RepoGrid } from "@/components/repo-card/repo-grid";
import { SaveButton } from "@/components/save-button";
import { savedRepos } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { fromDiscover } from "@/lib/repo-card";
import { currentUser } from "@/lib/session";
import type { DiscoverRepo } from "@/lib/types";

export const metadata: Metadata = { title: "Saved repos", robots: { index: false } };

export default async function SavedPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me/saved");
  const r = await savedRepos(user.id);
  const items = r.ok ? r.data.saved : [];
  const cards = items.flatMap((i) => (i.card ? [i.card as DiscoverRepo] : []));
  const unchecked = items.filter((i) => !i.card);

  return (
    <PageTransition>
      <>
      <div className="app-page">
      <AppPageHeader title="Saved repos" lead="Your shortlist. Each verdict is from the latest free report, not the day you saved it." />
      <div>
        {!r.ok ? (
          <ErrorPanel error={r.error} retryHref="/me/saved" />
        ) : items.length === 0 ? (
          <div className="max-w-3xl border border-dashed border-line-strong p-8 text-center">
            <CatFace mood="thinking" className="text-[1.6rem]" />
            <p className="mt-4 font-sans text-muted">
              Nothing saved yet. Press <span className="text-ink">save</span> on any report to keep that repo here.
            </p>
            <Link href="/discover" className="bracket-link mt-6">[ browse checked repos ]</Link>
          </div>
        ) : (
          <div className="space-y-10">
            {cards.length > 0 && <RepoGrid repos={cards.map(fromDiscover)} topicBase="/discover" saved={items.map((i) => i.repo)} fadeUnsaved />}
            {unchecked.length > 0 && (
              <section aria-labelledby="unchecked">
                <h2 id="unchecked" className="text-[1.05rem] font-semibold tracking-tight">Not checked recently</h2>
                <p className="mt-1 font-sans text-[0.9rem] text-muted">Holt has no current report for these. Open one to check it now; it takes about a minute.</p>
                <ul className="mt-4 divide-y divide-line border border-line-strong bg-panel shadow-soft">
                  {unchecked.map((i) => {
                    const [owner, name] = i.repo.split("/");
                    return (
                      <li key={i.repo} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-6">
                        <div className="min-w-0 flex-1 basis-full sm:basis-0">
                          <Link href={`/${i.repo}`} className="font-semibold tracking-tight [overflow-wrap:anywhere] hover:text-blue">
                            <span className="text-muted">{owner}/</span>
                            {name}
                          </Link>
                          <p className="text-[0.82rem] text-faint">saved <time dateTime={i.saved_at}>{timeAgo(i.saved_at)}</time></p>
                        </div>
                        <Link href={`/${i.repo}`} className="text-[0.87rem] text-green hover:underline">[ check it ]</Link>
                        <SaveButton repo={i.repo} saved />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <p className="text-[0.82rem] text-faint">
              {items.length} of {r.data.max_saved} saved. Press saved on a card to remove it; it leaves this list when you come back.
            </p>
          </div>
        )}
      </div>
      </div>
      </>
    </PageTransition>
  );
}
