// The signed-in home (docs/design/SIGNED-IN-HOME.md). Sign-in lands here, and
// so does "/" for anyone signed in. What it suggests comes from lib/home.ts.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageTransition } from "@/components/motion/page-transition";
import { PasteBox } from "@/components/paste-box";
import { ProfileOnboarding } from "@/components/profile-onboarding";
import type { Tile } from "@/components/home/shelf";
import { RepoRows, type RepoRow } from "@/components/repo-card/repo-grid";
import { contributions, discover, getProfile, history, me, recommendations, savedRepos } from "@/lib/api";
import { boardHref } from "@/lib/discover";
import { timeAgo } from "@/lib/format";
import { fastestReplies, groupPulls, nextStep, outsidePulls, replyLine, setupLeft, setupSteps, showProfilePrompt, type HomeState } from "@/lib/home";
import { SKIP_COOKIE } from "@/lib/profile";
import { languageName } from "@/lib/recommendations";
import { fromDiscover, fromPick, type CardRepo } from "@/lib/repo-card";
import { currentUser } from "@/lib/session";
import type { DiscoverRepo, DiscoverSort } from "@/lib/types";

export const metadata: Metadata = { title: "Your home", robots: { index: false } };

const NOTICES: Record<string, { tone: string; text: string }> = {
  saved: { tone: "text-green border-green/50 bg-green/10", text: "Profile saved. Your picks are below. Change it any time in settings." },
  adult: { tone: "text-orange border-orange/50 bg-orange/10", text: "Please confirm you're 18 or older to save a profile." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't save your profile just now. Try again in a minute." },
};

// The Hacktoberfest filter (PR #125) is a fifth argument to discover(). Until
// it's on main the argument is ignored, the response doesn't echo
// `hacktoberfest: true`, and the row stays hidden. Once #125 merges, call
// discover(..., true) directly.
const discoverWithHacktoberfest: (sort: DiscoverSort, language: string | null, topic: string | null, limit: number, hacktoberfest: boolean) => ReturnType<typeof discover> = discover;

/** A board entry as a card; `line` replaces its reason (why it's in this row). */
const discoverCard = (r: DiscoverRepo, line?: string | null): CardRepo => ({ ...fromDiscover(r), reason: line ?? r.reason });

export default async function HomePage({ searchParams }: PageProps<"/me">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me");
  const [sp, jar] = await Promise.all([searchParams, cookies()]);
  const [account, checks, picks, prs, profile, welcoming, trending, hacktoberfest, saved] = await Promise.all([
    me(user.id),
    history(user.id, 20),
    recommendations(user.id, 10),
    contributions(user.id),
    getProfile(user.id),
    discover("welcoming", null, null, 100),
    discover("trending", null, null, 12),
    discoverWithHacktoberfest("welcoming", null, null, 20, true),
    // One read for every save button on the page, and the Saved row.
    savedRepos(user.id),
  ]);
  const hf = hacktoberfest.ok && (hacktoberfest.data as { hacktoberfest?: boolean }).hacktoberfest === true ? hacktoberfest.data.repos : [];
  const prefs = profile.ok ? profile.data.profile : null;
  const langs = (prefs?.languages ?? []).slice(0, 2);
  const byLang = await Promise.all(langs.map((l) => discover("welcoming", l, null, 12)));

  const done = checks.ok ? checks.data.items.filter((h) => h.status === "done" && h.headline && h.tone) : [];
  const recent = done.filter((h, i) => done.findIndex((x) => x.repo === h.repo) === i).slice(0, 10);
  // Pull requests to other people's projects; the row and the next step skip your own.
  const pulls = prs.ok ? outsidePulls(prs.data.pull_requests, prs.data.login) : [];
  const savedItems = saved.ok ? saved.data.saved : [];
  // A check gets a full card when a list on this page already has its numbers;
  // history only knows the verdict, so the rest stay tiles.
  const known = new Map<string, CardRepo>();
  const learn = (r: DiscoverRepo) => known.set(r.repo.toLowerCase(), fromDiscover(r));
  [welcoming, trending, ...byLang].forEach((x) => x.ok && x.data.repos.forEach(learn));
  hf.forEach(learn);
  savedItems.forEach((i) => i.card && learn(i.card as DiscoverRepo));
  if (picks.ok) picks.data.picks.forEach((p) => known.set(p.repo.toLowerCase(), fromPick(p)));
  const waiting = pulls.filter((p) => p.state === "open");
  const state: HomeState = {
    checked: checks.ok ? checks.data.items.length : 0,
    hasProfile: profile.ok ? prefs !== null : null,
    // Not connected is a 404; any other error means connected but GitHub was slow.
    connected: prs.ok || prs.error.code !== "not_found",
    waiting,
    topPick: picks.ok && picks.data.picks[0] ? { repo: picks.data.picks[0].repo, reason: picks.data.picks[0].reason } : null,
  };
  const prompt = showProfilePrompt({ hasProfile: state.hasProfile, skipped: !!jar.get(SKIP_COOKIE) });
  const steps = setupSteps(state);
  const next = nextStep(state, timeAgo);
  const notice = typeof sp.profile === "string" ? NOTICES[sp.profile] : undefined;
  const credits = account.ok ? account.data.credits : null;
  const first = (user.name || "").trim().split(/\s+/)[0];

  const rows: RepoRow[] = [
    {
      title: "Picked for you",
      more: { href: "/for-you", label: "all picks" },
      note: picks.ok && picks.data.locked > 0 ? `${picks.data.locked} more with Holt Pro` : undefined,
      items: picks.ok ? picks.data.picks.map(fromPick) : [],
    },
    {
      title: "Your recent checks",
      more: { href: "/me/history", label: "all checks" },
      items: recent.map((h): CardRepo | Tile => {
        const card = known.get(h.repo.toLowerCase());
        if (card) return { ...card, issues: [], reason: `You ${h.mode === "ai" ? "got an AI report" : "checked it"} ${timeAgo(h.created_at)}.` };
        return { key: h.repo, repo: h.repo, href: `/${h.repo}${h.mode === "ai" ? "?mode=ai" : ""}`, verdict: { headline: h.headline!, tone: h.tone! }, line: null, meta: `${h.mode === "ai" ? "AI report" : "checked"} ${timeAgo(h.created_at)}` };
      }),
    },
    {
      title: "Your pull requests",
      more: { href: "/me/contributions", label: "all of them" },
      // One card per repo; repos with one still waiting come first.
      items: groupPulls(pulls).slice(0, 10),
    },
    {
      title: "Saved",
      more: { href: "/me/saved", label: "all saved" },
      items: savedItems.slice(0, 10).map((i): CardRepo | Tile =>
        i.card
          ? fromDiscover(i.card as DiscoverRepo)
          : { key: i.repo, repo: i.repo, href: `/${i.repo}`, verdict: null, line: "No recent report. Open it to check it now.", meta: `saved ${timeAgo(i.saved_at)}` },
      ),
    },
    ...langs.map((l, i): RepoRow => {
      const r = byLang[i];
      return {
        title: `Welcoming ${languageName(l)} repos`,
        more: { href: boardHref({ language: r.ok ? r.data.language ?? languageName(l) : languageName(l) }), label: "see the board" },
        note: "from your profile",
        items: r.ok ? r.data.repos.map((x) => discoverCard(x)) : [],
      };
    }),
    {
      title: "Fastest replies",
      more: { href: "/discover", label: "most welcoming" },
      note: "worth your time, quickest to answer",
      items: welcoming.ok ? fastestReplies(welcoming.data.repos).map((r) => discoverCard(r, replyLine(r.stats.median_first_response_hours))) : [],
    },
    {
      title: "Hacktoberfest",
      more: { href: "/hacktoberfest", label: "all of them" },
      note: "tagged for Hacktoberfest, worth your time",
      items: hf.map((r) => discoverCard(r)),
    },
    {
      title: "Trending on Holt",
      more: { href: boardHref({ sort: "trending" }), label: "see the board" },
      note: "most checked this week",
      items: trending.ok ? trending.data.repos.map((r) => discoverCard(r, r.checked_this_week != null ? `${r.checked_this_week} people checked it this week.` : null)) : [],
    },
  ];

  return (
    <PageTransition>
      <div className="relative overflow-hidden">
        <div aria-hidden="true" className="hero-backdrop" />
        <div className="wrap relative max-w-6xl pb-14 pt-8 sm:pb-16 sm:pt-12">
          <h1 className="display text-[clamp(1.9rem,6vw,2.6rem)]">
            {state.checked === 0 ? "Welcome" : "Welcome back"}{first ? `, ${first}` : ""}
          </h1>
          {notice && <p role="status" className={`mt-6 border px-4 py-3 font-sans text-[0.9rem] ${notice.tone}`}>{notice.text}</p>}

          {prompt && <ProfileOnboarding back="/me" open className="mt-6" />}

          <div className={`mt-6 grid gap-5 ${prompt ? "" : "lg:grid-cols-2"}`}>
            {!prompt && next.href !== "#check" && (
              <section aria-labelledby="next-h" className="border border-line-strong bg-panel p-5 shadow-card sm:p-6">
                <p className="text-[0.8rem] text-blue">Your next step</p>
                <h2 id="next-h" className="mt-1 text-[1.2rem] font-semibold tracking-tight [overflow-wrap:anywhere]">{next.title}</h2>
                <p className="prose-sans mt-2 text-[0.95rem] text-muted">{next.body}</p>
                <Link href={next.href} className="btn-primary mt-4 inline-flex">{next.cta}</Link>
              </section>
            )}
            <div id="check" className={`scroll-mt-24 ${!prompt && next.href === "#check" ? "lg:col-span-2" : "self-center"}`}>
              {!prompt && next.href === "#check" && (
                <>
                  <h2 className="text-[1.2rem] font-semibold tracking-tight">{next.title}</h2>
                  <p className="prose-sans mb-4 mt-2 max-w-2xl text-[0.95rem] text-muted">{next.body}</p>
                </>
              )}
              <PasteBox size="md" examples={state.checked === 0} />
            </div>
          </div>

          {setupLeft(steps) > 0 && (
            <section aria-labelledby="setup-h" className="mt-8 border border-blue/40 bg-panel p-5 shadow-soft sm:p-6">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="setup-h" className="text-[1.05rem] font-semibold tracking-tight">Get set up</h2>
                <span className="text-[0.75rem] text-faint">{steps.length - setupLeft(steps)} of {steps.length} done</span>
              </div>
              <div aria-hidden="true" className="mt-3 h-1 bg-line">
                <div className="h-1 bg-blue" style={{ width: `${((steps.length - setupLeft(steps)) / steps.length) * 100}%` }} />
              </div>
              <ol className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {steps.map((s) => (
                  <li key={s.id} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
                    <span aria-hidden="true" className={s.done ? "text-green" : "text-faint"}>{s.done ? "✓" : "○"}</span>
                    {s.done ? (
                      <span className="text-muted"><span className="sr-only">Done: </span>{s.label}</span>
                    ) : (
                      <span>
                        <Link href={s.href} className="font-semibold text-blue hover:underline">{s.label}</Link>
                        <span className="block font-sans text-[0.85rem] text-muted">{s.note}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="mt-10">
            <RepoRows rows={rows} saved={saved.ok ? savedItems.map((i) => i.repo) : []} />
          </div>

          {credits?.ai_available && (
            <p className="mt-10 font-sans text-[0.9rem] text-muted">
              <strong className="text-ink">{credits.balance}</strong> {credits.purchased > 0 ? "AI report credits" : "free AI reports"} left.{" "}
              {credits.can_claim ? (
                <Link href="/settings" className="text-link">Claim this week&apos;s free one</Link>
              ) : (
                <Link href="/settings" className="text-link">How they work</Link>
              )}
            </p>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
