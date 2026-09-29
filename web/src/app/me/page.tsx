// The signed-in home (docs/design/SIGNED-IN-HOME.md): your open-source to-do
// list, with Holt's verdict on each item. One primary action per state (new or
// returning, lib/home.ts), then your pull requests, saved repos, picks and
// checks, each hidden when empty.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CheckedList } from "@/components/home/checked-list";
import { PullCard } from "@/components/home/pull-card";
import { PageTransition } from "@/components/motion/page-transition";
import { PasteBox } from "@/components/paste-box";
import { ProfileFlow } from "@/components/profile-flow";
import { RepoGrid } from "@/components/repo-card/repo-grid";
import { AppPageHeader, SectionHead } from "@/components/shell/app-page";
import { FocusOnHash } from "@/components/shell/check-focus";
import { QuickCheck } from "@/components/shell/quick-check";
import { contributions, getProfile, history, me, recommendations, savedRepos } from "@/lib/api";
import { boardHref } from "@/lib/discover";
import { dismissedNudges, groupPulls, homeKind, homeNudge, NUDGE_COOKIE, outsidePulls, primaryAction, statusLine, type Nudge } from "@/lib/home";
import { SKIP_COOKIE } from "@/lib/profile";
import { basisLine, lockedLine } from "@/lib/recommendations";
import { fromDiscover, fromPick } from "@/lib/repo-card";
import { currentUser } from "@/lib/session";
import { PROFILE_SETTINGS } from "@/lib/settings";
import { hacktoberfest } from "@/lib/site";
import type { DiscoverRepo } from "@/lib/types";
import { dismissNudge } from "./actions";

export const metadata: Metadata = { title: "Your home", robots: { index: false } };

const NOTICES: Record<string, { tone: string; text: string }> = {
  saved: { tone: "text-green border-green/50 bg-green/10", text: "Profile saved. Your picks are below." },
  adult: { tone: "text-orange border-orange/50 bg-orange/10", text: "Please confirm you're 18 or older to save a profile." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't save your profile just now. Try again in a minute." },
};

const NUDGES: Record<Nudge, { text: string; href: string; cta: string }> = {
  profile: { text: "Tell Holt your languages and it picks repos for you.", href: PROFILE_SETTINGS, cta: "add your languages" },
  github: { text: "Connect GitHub to see your pull requests here.", href: "/connect", cta: "connect GitHub" },
};

export default async function HomePage({ searchParams }: PageProps<"/me">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me");
  const [sp, jar] = await Promise.all([searchParams, cookies()]);
  const [account, checks, saved, picks, prs, profile] = await Promise.all([
    me(user.id),
    history(user.id, 20),
    savedRepos(user.id),
    recommendations(user.id, 10),
    contributions(user.id),
    getProfile(user.id),
  ]);

  const done = checks.ok ? checks.data.items.filter((h) => h.status === "done" && h.headline && h.tone) : [];
  const recent = done.filter((h, i) => done.findIndex((x) => x.repo === h.repo) === i).slice(0, 6);
  const savedItems = saved.ok ? saved.data.saved : [];
  const savedCards = savedItems.flatMap((i) => (i.card ? [fromDiscover(i.card as DiscoverRepo)] : [])).slice(0, 6);
  const savedNames = savedItems.map((i) => i.repo);
  // Pull requests to other people's projects only, one card per repo.
  const pulls = prs.ok ? outsidePulls(prs.data.pull_requests, prs.data.login) : [];
  const groups = groupPulls(pulls);
  const waiting = groups.reduce((n, g) => n + g.open, 0);
  const pickCards = picks.ok ? picks.data.picks.map(fromPick) : [];
  const prefs = profile.ok ? profile.data.profile : null;
  const hasProfile = profile.ok ? prefs !== null : null;

  const kind = homeKind({ checked: checks.ok ? checks.data.items.length : 0, saved: savedItems.length, pulls: pulls.length });
  const primary = primaryAction(kind, { hasProfile, skipped: !!jar.get(SKIP_COOKIE) });
  // Not connected is a 404; any other error means connected but GitHub was slow.
  const connected = prs.ok || prs.error.code !== "not_found";
  const nudge = homeNudge({ primary, hasProfile, connected, dismissed: dismissedNudges(jar.get(NUDGE_COOKIE)?.value) });
  const status = statusLine({ waiting, credits: account.ok ? account.data.credits : null });
  const notice = typeof sp.profile === "string" ? NOTICES[sp.profile] : undefined;
  const first = (user.name || "").trim().split(/\s+/)[0];
  const hf = hacktoberfest()?.live === true;

  return (
    <PageTransition>
      <div className="app-page">
        <FocusOnHash />
        <AppPageHeader
          title={`${kind === "new" ? "Welcome" : "Welcome back"}${first ? `, ${first}` : ""}`}
          lead={kind === "new" ? "Let's find you a repo worth your time." : status || null}
        />
        {notice && <p role="status" className={`mb-6 border px-4 py-3 font-sans text-[0.9rem] ${notice.tone}`}>{notice.text}</p>}

        {primary === "check" && (
          <div id="check" data-check-target="page" className="scroll-mt-24">
            <PasteBox size="md" examples={false} />
          </div>
        )}
        {primary === "profile" && <ProfileFlow adultConfirmed={profile.ok && profile.data.adult_confirmed} />}
        {primary === "find" && (
          <section aria-labelledby="find-h" className="border border-line-strong bg-panel p-5 shadow-soft sm:p-6">
            <h2 id="find-h" className="text-[1.15rem] font-semibold tracking-tight">Find a project worth your time</h2>
            <p className="mt-1 max-w-xl font-sans text-[0.95rem] text-muted">
              Repos that reply to and merge outsiders, in your languages, with issues to start on.
            </p>
            <Link href="/find" className="btn-primary mt-4">find a project →</Link>
          </section>
        )}
        {kind === "new" && (
          <div id="check" className="mt-6 scroll-mt-24">
            <p className="mb-2 font-sans text-[0.92rem] text-muted">Have a repo in mind?</p>
            <QuickCheck variant="inline" />
          </div>
        )}

        {nudge && (
          <form action={dismissNudge} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-blue py-1 pl-3 font-sans text-[0.9rem] text-muted">
            <input type="hidden" name="nudge" value={nudge} />
            <span>{NUDGES[nudge].text}</span>
            <Link href={NUDGES[nudge].href} className="font-mono text-[0.86rem] text-blue hover:underline">{NUDGES[nudge].cta}</Link>
            <button type="submit" aria-label="Dismiss" className="ml-auto grid size-11 place-items-center text-faint hover:text-ink sm:size-8">×</button>
          </form>
        )}

        <div className="mt-12 space-y-12">
          {groups.length > 0 && (
            <section aria-labelledby="prs-h">
              <SectionHead id="prs-h" title="Your pull requests" more={{ href: "/me/contributions", label: "all your pull requests" }} />
              <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups.slice(0, 6).map((g) => <li key={g.repo} className="min-w-0"><PullCard g={g} /></li>)}
              </ol>
            </section>
          )}

          {savedCards.length > 0 && (
            <section aria-labelledby="saved-h">
              <SectionHead id="saved-h" title="Saved" more={{ href: "/me/saved", label: `all saved (${savedItems.length})` }} />
              <RepoGrid repos={savedCards} saved={savedNames} topicBase="/discover" />
            </section>
          )}

          {pickCards.length > 0 && picks.ok && (
            <section id="picks" aria-labelledby="picks-h" className="scroll-mt-24">
              <SectionHead id="picks-h" title="Picked for you" more={{ href: PROFILE_SETTINGS, label: "edit your profile" }} />
              {basisLine(picks.data.basis) && <p className="-mt-1 mb-4 font-sans text-[0.9rem] text-muted">{basisLine(picks.data.basis)}</p>}
              <RepoGrid repos={pickCards} saved={savedNames} topicBase="/discover" />
              {picks.data.locked > 0 && (
                <p className="mt-4 font-sans text-[0.9rem] text-muted">
                  {lockedLine(picks.data.locked)} The full list comes with Holt Pro.{" "}
                  <Link href="/pricing" className="text-link font-mono text-[0.86rem]">see plans</Link>
                </p>
              )}
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="checked-h">
              <SectionHead id="checked-h" title="Recently checked" more={{ href: "/me/history", label: "all checks" }} />
              <CheckedList items={recent} />
            </section>
          )}

          <p className="font-sans text-[0.92rem] text-muted">
            Rather browse?{" "}
            <Link href={boardHref({})} className="text-link font-mono text-[0.88rem]">most welcoming</Link>
            {" · "}
            <Link href={boardHref({ sort: "trending" })} className="text-link font-mono text-[0.88rem]">trending</Link>
            {hf && (
              <>
                {" · "}
                <Link href="/hacktoberfest" className="text-link font-mono text-[0.88rem]">Hacktoberfest</Link>
              </>
            )}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
