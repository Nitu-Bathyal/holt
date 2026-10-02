// Every pick (the home shows the first three): the repos Holt picked for this
// person, in the server's order, each card with its reason. The first part
// comes with the page; the rest load as the reader nears the end
// (picks-list.tsx).
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorPanel } from "@/components/error-panel";
import { PageTransition } from "@/components/motion/page-transition";
import { AppPageHeader } from "@/components/shell/app-page";
import { recommendations, savedNames } from "@/lib/api";
import { basisLine, cardReasons, emptyReason, noPicks, pickCursor, PICKS_PART } from "@/lib/recommendations";
import { currentUser } from "@/lib/session";
import { CONNECT_GITHUB, PROFILE_SETTINGS } from "@/lib/settings";
import { PicksList } from "./picks-list";

export const metadata: Metadata = { title: "Your picks", robots: { index: false } };

export default async function PicksPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me/picks");
  const [picks, saved] = await Promise.all([recommendations(user.id, PICKS_PART), savedNames(user.id)]);

  if (!picks.ok) {
    return (
      <PageTransition>
        <div className="app-page">
          <AppPageHeader sentence title="Your picks" />
          <ErrorPanel error={picks.error} retryHref="/me/picks" />
        </div>
      </PageTransition>
    );
  }

  const { basis, total, next } = picks.data;
  const generic = emptyReason(basis) === "nothing-to-match";
  const profile = generic ? "add your languages" : "edit your profile";

  if (total === 0) {
    const none = noPicks(basis);
    return (
      <PageTransition>
        <div className="app-page">
          <AppPageHeader sentence title={none.line} mood="thinking">
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={PROFILE_SETTINGS} className="btn-primary">{profile} →</Link>
              {none.actions.includes("github") && <Link href={CONNECT_GITHUB} className="text-link tap text-[0.9rem]">connect GitHub</Link>}
            </div>
          </AppPageHeader>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="app-page">
        <AppPageHeader sentence title={generic ? "Good places to start" : "Picked for you"} lead={basisLine(basis)} mood="ready">
          <p className="mt-4 flex flex-wrap items-baseline gap-x-4 text-[0.82rem]">
            <span className="text-faint tabular-nums">{total === 1 ? "1 repo" : `${total} repos`}</span>
            <Link href={PROFILE_SETTINGS} className="inline-flex min-h-11 items-center text-blue hover:underline sm:min-h-0">{profile}</Link>
          </p>
        </AppPageHeader>
        <PicksList first={{ items: picks.data.picks, next: pickCursor(next), total }} saved={saved ?? []} why={cardReasons(basis)} />
      </div>
    </PageTransition>
  );
}
