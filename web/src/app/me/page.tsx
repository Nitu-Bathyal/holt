// The signed-in home (docs/design/DASHBOARD.md): your next move in open
// source, and why. The headline is the one thing to do now, over the loop
// (find a repo → pick an issue → open a PR → get it merged), worked out from
// the account by lib/home.ts. Below it, each hidden when empty: also for you,
// in flight, next repos for you, your repos.
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MoveHead } from "@/components/home/move-head";
import { WaitBar } from "@/components/home/wait-bar";
import { PageTransition } from "@/components/motion/page-transition";
import { ProfileFlow } from "@/components/profile-flow";
import { RepoGrid } from "@/components/repo-card/repo-grid";
import { VerdictPill } from "@/components/report/verdict-pill";
import { SaveButton } from "@/components/save-button";
import { SectionHead } from "@/components/shell/app-page";
import { FocusOnHash } from "@/components/shell/check-focus";
import { QuickCheck } from "@/components/shell/quick-check";
import { RepoRows } from "@/components/your-repos/repo-rows";
import { contributions, getProfile, history, preflightState, recommendations, savedRepos, starterIssues } from "@/lib/api";
import type { CatMood } from "@/lib/cat";
import { humanHours, timeAgo } from "@/lib/format";
import { alsoForYou, clock, dismissedNudges, homeNudge, moveLead, moveTitle, nextMove, NUDGE_COOKIE, othersInFlight, outsidePulls, type NextMove, type Nudge } from "@/lib/home";
import { showPreflight } from "@/lib/preflight";
import { SKIP_COOKIE } from "@/lib/profile";
import { basisLine, lockedLine } from "@/lib/recommendations";
import { fromPick } from "@/lib/repo-card";
import { caller, currentUser } from "@/lib/session";
import { CONNECT_GITHUB, PROFILE_SETTINGS } from "@/lib/settings";
import { yourRepos } from "@/lib/your-repos";
import { dismissNudge } from "./actions";

export const metadata: Metadata = { title: "Your home", robots: { index: false } };

const NOTICES: Record<string, { tone: string; text: string }> = {
  saved: { tone: "text-green border-green/50 bg-green/10", text: "Profile saved. Your picks are below." },
  adult: { tone: "text-orange border-orange/50 bg-orange/10", text: "Please confirm you're 18 or older to save a profile." },
  error: { tone: "text-orange border-orange/50 bg-orange/10", text: "We couldn't save your profile just now. Try again in a minute." },
};

const NUDGES: Record<Nudge, { text: string; href: string; cta: string }> = {
  profile: { text: "Tell Holt your languages and it picks repos for you.", href: PROFILE_SETTINGS, cta: "add your languages" },
  github: { text: "Connect GitHub to see your pull requests here.", href: CONNECT_GITHUB, cta: "connect GitHub" },
};

function mood(m: NextMove): CatMood {
  if (m.kind === "merged") return "celebrating";
  if (m.kind === "waiting") return m.wait.late ? "thinking" : "ready";
  if (m.kind === "issue") return "determined";
  return "ready";
}

export default async function HomePage({ searchParams }: PageProps<"/me">) {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=/me");
  const [sp, jar, who] = await Promise.all([searchParams, cookies(), caller(user)]);
  const [checks, saved, picks, prs, profile, pre] = await Promise.all([
    history(user.id, 50),
    savedRepos(user.id),
    recommendations(user.id, 10),
    contributions(user.id),
    getProfile(user.id),
    preflightState({}, who),
  ]);

  const now = clock();
  const savedItems = saved.ok ? saved.data.saved : [];
  const savedNames = savedItems.map((i) => i.repo);
  const repos = yourRepos(savedItems, checks.ok ? checks.data.items : [], now);
  // Pull requests to other people's projects that count (not left out of your numbers).
  const pulls = prs.ok ? outsidePulls(prs.data.pull_requests, prs.data.login).filter((p) => p.counted) : [];
  const move = nextMove({ pulls, repos, now });
  const also = alsoForYou(move, { pulls, repos, now });
  const flying = othersInFlight(move, pulls, now);
  const issues = move.kind === "issue" ? await starterIssues(move.repo, 3, who) : null;

  const pickCards = picks.ok ? picks.data.picks.map(fromPick) : [];
  const hasProfile = profile.ok ? profile.data.profile !== null : null;
  const askingProfile = move.kind === "first" && hasProfile === false && !jar.get(SKIP_COOKIE) && pickCards.length === 0;
  // Not connected is a 404; any other error means connected but GitHub was slow.
  const connected = prs.ok || prs.error.code !== "not_found";
  // Picks already come from somewhere (a profile or GitHub): no asking for languages over them.
  const nudge = homeNudge({ askingProfile, hasProfile: pickCards.length ? true : hasProfile, connected, dismissed: dismissedNudges(jar.get(NUDGE_COOKIE)?.value) });
  const notice = typeof sp.profile === "string" ? NOTICES[sp.profile] : undefined;
  const preflight = pre.ok && showPreflight(pre.data);
  const firstPicks = move.kind === "first" && pickCards.length > 0;

  let primary: React.ReactNode = null;
  if (move.kind === "waiting") {
    const url = move.wait.pr.url;
    primary = preflight ? (
      <>
        <Link href={`/preflight?pr=${encodeURIComponent(url)}`} className="btn-primary">check it with pre-flight →</Link>
        <a href={url} className="text-link text-[0.9rem]">open it on GitHub ↗</a>
      </>
    ) : (
      <a href={url} className="btn-primary">open it on GitHub ↗</a>
    );
  } else if (move.kind === "merged") {
    primary = (
      <>
        <Link href={`/${move.pr.repo}`} className="btn-primary">find your next issue there →</Link>
        <Link href="/find" className="text-link text-[0.9rem]">or a new repo</Link>
      </>
    );
  } else if (move.kind === "first" && !askingProfile) {
    primary = <Link href="/find" className="btn-primary">find a project →</Link>;
  }

  return (
    <PageTransition>
      <div className="app-page">
        <FocusOnHash />
        <div id="check" className="scroll-mt-24 pt-6 md:hidden">
          <QuickCheck variant="inline" />
        </div>
        <MoveHead title={moveTitle(move)} lead={moveLead(move)} mood={mood(move)} step={move.step}>
          {primary && <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">{primary}</div>}
        </MoveHead>
        {notice && <p role="status" className={`mb-6 border px-4 py-3 font-sans text-[0.9rem] ${notice.tone}`}>{notice.text}</p>}

        {askingProfile && (
          <div className="mt-10">
            <ProfileFlow adultConfirmed={profile.ok && profile.data.adult_confirmed} />
          </div>
        )}

        {move.kind === "issue" && (
          <section aria-labelledby="issues-h" className="mt-12">
            <SectionHead id="issues-h" title="Starter issues" more={{ href: `/${move.repo}`, label: "the report" }} />
            {issues?.ok && issues.data.issues.length > 0 ? (
              <ul>
                {issues.data.issues.map((iss, i) => (
                  <li key={iss.number} data-rule className="app-row grid-cols-[minmax(0,1fr)_auto]" style={{ "--rule": "var(--blue)" } as React.CSSProperties}>
                    <div className="min-w-0 pl-2">
                      <p className="font-sans text-[0.95rem]"><span className="text-blue">#{iss.number}</span> {iss.title}</p>
                      <p className="mt-1 text-[0.76rem] text-faint">
                        {iss.labels.slice(0, 3).join(" · ")}
                        {iss.created_at && <> · opened {timeAgo(iss.created_at)}</>}
                      </p>
                    </div>
                    <a href={iss.url} className={i === 0 ? "btn-primary min-h-10 px-4 text-[0.84rem]" : "text-link text-[0.84rem]"}>
                      {i === 0 ? "take this one ↗" : "open ↗"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Link href={`/${move.repo}`} className="btn-primary mt-2">see what to work on →</Link>
            )}
          </section>
        )}

        {nudge && (
          <form action={dismissNudge} className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-blue py-1 pl-3 font-sans text-[0.9rem] text-muted">
            <input type="hidden" name="nudge" value={nudge} />
            <span>{NUDGES[nudge].text}</span>
            <Link href={NUDGES[nudge].href} className="font-mono text-[0.86rem] text-blue hover:underline">{NUDGES[nudge].cta}</Link>
            <button type="submit" aria-label="Dismiss" className="ml-auto grid size-11 place-items-center text-faint hover:text-ink sm:size-8">×</button>
          </form>
        )}

        <div className="mt-14 space-y-14">
          {also.length > 0 && (
            <section aria-labelledby="also-h">
              <SectionHead id="also-h" title="Also for you" />
              <ul>
                {also.map((a) =>
                  a.kind === "checking" || a.kind === "ready" ? (
                    <li key={a.repo.repo} data-rule className="app-row grid-cols-[minmax(0,1fr)_auto]" style={{ "--rule": a.kind === "ready" ? "var(--green)" : "var(--blue)" } as React.CSSProperties}>
                      <p className="pl-2 font-sans text-[0.95rem]">
                        {a.kind === "checking" ? (
                          <>Holt is checking <span className="font-mono font-semibold">{a.repo.repo}</span>.</>
                        ) : (
                          <>
                            <span className="font-mono font-semibold">{a.repo.repo}</span> is checked:{" "}
                            {a.repo.headline && a.repo.tone && <VerdictPill headline={a.repo.headline} tone={a.repo.tone} className="px-1.5 py-0.5 text-[0.74rem]" />}
                          </>
                        )}
                      </p>
                      <Link href={`/${a.repo.repo}${a.repo.ai ? "?mode=ai" : ""}`} className="text-link text-[0.84rem]">{a.kind === "checking" ? "watch it →" : "open it →"}</Link>
                    </li>
                  ) : a.kind === "late" ? (
                    <li key={a.wait.pr.url} data-rule className="app-row grid-cols-[minmax(0,1fr)_auto]" style={{ "--rule": "var(--orange)" } as React.CSSProperties}>
                      <p className="pl-2 font-sans text-[0.95rem]">
                        Your PR to <span className="font-mono font-semibold">{a.wait.pr.repo}</span> has waited {humanHours(a.wait.hours)}. Replies there usually take {humanHours(a.wait.typical)}.
                      </p>
                      <a href={a.wait.pr.url} className="text-link text-[0.84rem]">open it ↗</a>
                    </li>
                  ) : (
                    <li key={a.repo.repo} data-rule className="app-row grid-cols-[minmax(0,1fr)_auto]" style={{ "--rule": "var(--orange)" } as React.CSSProperties}>
                      <p className="pl-2 font-sans text-[0.95rem]">
                        You saved <Link href={`/${a.repo.repo}`} className="font-mono font-semibold hover:text-blue">{a.repo.repo}</Link>. Holt now says <span className="text-orange">{a.repo.headline?.toLowerCase()}</span>.
                      </p>
                      <SaveButton repo={a.repo.repo} saved compact />
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          {flying.length > 0 && (
            <section aria-labelledby="flight-h">
              <SectionHead id="flight-h" title="In flight" more={{ href: "/me/contributions", label: "all your pull requests" }} />
              <ul>
                {flying.map((w) => (
                  <li key={w.pr.url} data-rule className="app-row grid-cols-[minmax(0,1fr)]" style={{ "--rule": "var(--blue)" } as React.CSSProperties}>
                    <div className="min-w-0 pl-2">
                      <p className="text-[0.9rem]"><span className="font-semibold">{w.pr.repo}</span> <span className="text-faint">#{w.pr.number}</span></p>
                      <a href={w.pr.url} className="block truncate font-sans text-[0.95rem] hover:underline">{w.pr.title}</a>
                      <WaitBar w={w} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pickCards.length > 0 && picks.ok && (
            <section id="picks" aria-labelledby="picks-h" className="scroll-mt-24">
              <SectionHead id="picks-h" title={firstPicks ? "Picked for you" : "Next repos for you"} more={{ href: PROFILE_SETTINGS, label: "edit your profile" }} />
              {basisLine(picks.data.basis) && <p className="-mt-1 mb-4 font-sans text-[0.9rem] text-muted">{basisLine(picks.data.basis)}</p>}
              <RepoGrid repos={pickCards.slice(0, 3)} saved={savedNames} topicBase="/discover" />
              {picks.data.locked > 0 && (
                <p className="mt-4 font-sans text-[0.9rem] text-muted">
                  {lockedLine(picks.data.locked)} <Link href="/pricing" className="text-link font-mono text-[0.86rem]">see plans</Link>
                </p>
              )}
            </section>
          )}

          {repos.length > 0 && (
            <section aria-labelledby="mine-h">
              <SectionHead id="mine-h" title="Your repos" more={{ href: "/me/repos", label: `all ${repos.length}` }} />
              <RepoRows rows={repos.slice(0, 4)} saved={savedNames} compact />
            </section>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
