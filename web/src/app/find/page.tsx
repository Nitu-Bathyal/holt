import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { FindView } from "@/components/find/find-view";
import { PageTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import { getProfile, savedNames } from "@/lib/api";
import { cachedFind } from "@/lib/find-cached";
import { findQuery, PICKS_COOKIE, resolvePicks } from "@/lib/find-picks";
import { caller, currentUser } from "@/lib/session";
import { hacktoberfestSwitch } from "@/lib/site";

export const metadata: Metadata = {
  title: "Find a project",
  description: "Projects that reply to and merge outside contributors, with specific issues to start on. Filter by language and how much time you have.",
  alternates: { canonical: "/find" },
};

// Results come first: the page always searches (the default search is shared
// by every visitor, so it's almost always cached), and the filters refine it
// in place. See components/find/find-view.tsx.
export default async function FindPage({ searchParams }: PageProps<"/find">) {
  const [sp, user, jar] = await Promise.all([searchParams, currentUser(), cookies()]);
  const [profileR, saved] = await Promise.all([user ? getProfile(user.id) : null, savedNames(user?.id)]);
  const profile = profileR?.ok ? profileR.data.profile : null;
  // An explicit choice (URL, last picks) wins; otherwise the switch starts on only in October.
  const hf = hacktoberfestSwitch();
  const { picks, source } = resolvePicks({ params: sp, cookie: jar.get(PICKS_COOKIE)?.value, profile, hfWindow: Boolean(hf), hfOn: hf?.on ?? false });
  const result = await cachedFind(findQuery(picks), await caller(user));

  return (
    <PageTransition>
      <>
        <PageHead compact>
          <h1 className="text-[clamp(1.45rem,3.4vw,2.1rem)] font-semibold leading-tight tracking-tight">Find a project that will merge your work</h1>
          <p className="mt-2 hidden max-w-2xl font-sans text-[0.95rem] text-muted sm:block">
            Every repo here replies to outsiders and merges their PRs. Each has issues you could take today.
          </p>
          {sp.profile === "saved" && (
            <p role="status" className="mt-4 border border-green/50 bg-green/10 px-4 py-2.5 font-sans text-[0.9rem] text-green">
              Profile saved. This search uses it; change it any time in <Link href="/settings/profile" className="underline">settings</Link>.
            </p>
          )}
        </PageHead>
        <div className="wrap py-5 sm:py-6">
          <FindView initialPicks={picks} initial={result} source={source} hf={hf} saved={saved} />
          <ProfileOnboarding back="/find" className="mt-10" />
        </div>
      </>
    </PageTransition>
  );
}
