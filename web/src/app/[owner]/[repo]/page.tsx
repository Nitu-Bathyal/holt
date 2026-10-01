import type { Metadata } from "next";
import Link from "next/link";
import { ViewTransition } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { ErrorPanel } from "@/components/error-panel";
import { AnalysisRunner } from "@/components/report/analysis-runner";
import { MergePlanPanel } from "@/components/report/merge-plan-panel";
import { PartialReport } from "@/components/report/partial-report";
import { ReportTeaser } from "@/components/report/report-teaser";
import { ReportView } from "@/components/report/report-view";
import { RepoAbout } from "@/components/report/repo-about";
import { StarterIssues, StarterIssuesSkeleton } from "@/components/report/starter-issues";
import { SkeletonReveal } from "@/components/motion/reveal";
import { isBot, mintTicket } from "@/lib/anon-check";
import { getReport, recordView, savedState, starterIssues } from "@/lib/api";
import { authSecret } from "@/lib/auth-secret";
import { budgetFrom, reportHref } from "@/lib/budget";
import { EXAMPLES_PATH } from "@/lib/examples";
import { reportAccess, reportShows, signInHref } from "@/lib/gate";
import { isValidRepo } from "@/lib/repo";
import { caller, currentUser, type SessionUser } from "@/lib/session";
import { humanHours } from "@/lib/format";
import { SITE_URL } from "@/lib/site";
import type { Mode, Report } from "@/lib/types";
import { PageTransition } from "@/components/motion/page-transition";
import { BackLink } from "@/components/your-repos/back-link";
import { SaveButton } from "@/components/save-button";
import { ReportStickyBar, StickySentinel } from "@/components/report/report-sticky-bar";
import { ShareMenu } from "@/components/report/share-bar";
import { ReportModeLink } from "@/components/report/report-tabs";

type Props = PageProps<"/[owner]/[repo]">;

/** Signed out, a report nobody has made yet: a ticket to run the free check here, for people only (lib/anon-check.ts). */
async function anonTicket(repo: string, days: number): Promise<string | null> {
  const secret = authSecret(process.env);
  if (!secret || isBot((await headers()).get("user-agent"))) return null;
  return mintTicket(secret, repo, days);
}

function opts(sp: Record<string, string | string[] | undefined>): { mode: Mode; days: number } {
  const mode: Mode = sp.mode === "ai" ? "ai" : "rules";
  return { mode, days: budgetFrom(sp.days) };
}

function describe(report: Report | null, name: string): string {
  if (!report) return `Do outsiders get replies and get merged at ${name}? Holt checks its recent PRs and tells you.`;
  const s = report.stats;
  const reply = s.median_first_response_hours == null ? "" : `, and the typical first reply takes ${humanHours(s.median_first_response_hours)}`;
  return `${report.headline}. ${s.outsider_merged} of ${s.outsider_attempts} outside PRs got merged${reply}. See the evidence and starter issues.`;
}

const titleFor = (name: string) => `${name}: Worth your time? · Holt`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) return {};
  const r = await getReport(`${owner}/${repo}`);
  const name = r.ok ? r.data.repo : `${owner}/${repo}`;
  const title = titleFor(name);
  const description = describe(r.ok ? r.data : null, name);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/${name}` },
    openGraph: { title, description, url: `/${name}`, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** schema.org description of the page, for search engines. */
function JsonLd({ report, name }: { report: Report | null; name: string }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: titleFor(name),
    url: `${SITE_URL}/${name}`,
    description: describe(report, name),
    ...(report ? { dateModified: report.generated_at } : {}),
    isPartOf: { "@type": "WebSite", name: "Holt", url: SITE_URL },
    about: { "@type": "SoftwareSourceCode", name, codeRepository: `https://github.com/${name}` },
  };
  // Escape "<" so repo-controlled text can never close the script tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export default async function RepoPage({ params, searchParams }: Props) {
  const { owner, repo } = await params;
  if (!isValidRepo(owner, repo)) notFound();
  const sp = await searchParams;
  const { mode, days } = opts(sp);
  const name = `${owner}/${repo}`;
  const user = await currentUser();
  const signedIn = Boolean(user);
  if (mode === "ai" && !signedIn) redirect(signInHref(`/${name}?mode=ai`));

  // Only the report (and, signed in, whether it's saved: one database read)
  // blocks the page; starter issues (a live GitHub call) stream in.
  // The AI tab is the merge plan, made from the free report: its header reads that.
  const [report, saved] = await Promise.all([
    getReport(name, "rules", days),
    user ? savedState(user.id, name) : null,
  ]);

  // Normalise to GitHub's casing so shared links and caches agree.
  if (report.ok && report.data.repo !== name && report.data.repo.toLowerCase() === name.toLowerCase()) {
    redirect(reportHref(report.data.repo, days, mode));
  }

  const display = report.ok ? report.data.repo : name;
  // For Connect GitHub users' "opened a PR after checking it on Holt" (the server ignores the rest).
  if (user && report.ok) after(() => recordView(user.id, report.data.repo));
  const [dOwner, dRepo] = display.split("/");
  // Signed out: the examples in full, every other repo as a teaser. A repo with
  // no report yet runs the free check and ends on the teaser; bots, and anyone
  // over the per-IP limit, get the teaser that offers sign-in instead.
  const access = reportAccess(display, signedIn);
  const found = report.ok ? "report" : report.error.code === "not_found" ? "missing" : "error";
  const ticket = !signedIn && found === "missing" ? await anonTicket(name, days) : null;
  const shows = reportShows({ repo: display, signedIn, found, anonymousCheck: ticket !== null });
  const teaser = shows === "teaser" || shows === "sign-in";

  return (
    <PageTransition>
      <div className="relative">
      <div className="report-wide relative py-8 sm:py-12">
        {mode === "rules" && <JsonLd report={report.ok ? report.data : null} name={display} />}
        <BackLink repo={display} />
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://github.com/${dOwner}.png?size=80`}
            alt=""
            width={40}
            height={40}
            // Decorative and small: don't compete with the CSS and fonts the verdict needs.
            fetchPriority="low"
            decoding="async"
            // Level with the name, not the middle of a tall details block.
            className="size-10 self-start rounded-md border border-line-strong bg-panel-2"
          />
          {report.ok && report.data.about ? (
            <div className="min-w-0 flex-1">
              <RepoAbout about={report.data.about} repo={display} />
            </div>
          ) : (
          <div className="min-w-0 flex-1">
            <p className="text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.25rem]">
              <span className="text-muted">{dOwner}/</span>
              {dRepo}
            </p>
            <a href={`https://github.com/${display}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center truncate text-[0.82rem] text-faint hover:text-blue sm:block sm:min-h-0">
              github.com/{display} ↗
            </a>
          </div>
          )}
          {/* A failed lookup shows "save"; saving again is harmless. Keyed so
              moving to another repo's report starts from that repo's state. */}
          {/* Save, and under it share: two quiet icons, the bookmark's right edge shared. */}
          <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:w-auto sm:flex-col sm:items-end sm:justify-start">
            <div className="flex items-center gap-3">
              <ReportModeLink
                mode={mode}
                rulesHref={reportHref(display, days)}
                aiHref={signedIn ? `/${display}?mode=ai` : `/signin?callbackUrl=${encodeURIComponent(`/${display}?mode=ai`)}`}
                hint
              />
              <SaveButton small compact key={display} repo={display} saved={user ? Boolean(saved?.ok && saved.data.saved) : null} />
            </div>
            <ShareMenu url={`${SITE_URL}/${display}`} text={report.ok ? `${display} on Holt: ${report.data.headline}.` : `${display} on Holt.`} />
          </div>
        </div>
        <StickySentinel />
        {report.ok && mode === "rules" && !teaser && (
          <ReportStickyBar repo={display}>
            <SaveButton small compact key={`bar-${display}`} repo={display} saved={user ? Boolean(saved?.ok && saved.data.saved) : null} />
          </ReportStickyBar>
        )}

        {!signedIn && access === "full" && report.ok && <ExampleNote />}

        {/* Switching between the free and AI tabs crossfades the report, not the page. */}
        <ViewTransition key={mode} name="report-body" share="swap" enter="swap" exit="swap" default="none">
          <div>
            {mode === "ai" ? (
              report.ok ? (
                <MergePlanPanel repo={report.data.repo} />
              ) : report.error.code === "not_found" ? (
                <p className="border border-line-strong bg-panel p-5 font-sans sm:p-8" data-merge-plan-no-report>
                  <Link href={reportHref(name, days)} className="text-link">check this repo first →</Link>
                </p>
              ) : (
                <ErrorPanel error={report.error} repo={name} retryHref={reportHref(name, days, mode)} />
              )
            ) : teaser ? (
              report.ok ? (
                <PartialReport report={report.data} back={reportHref(display, days)} />
              ) : (
                <ReportTeaser repo={display} report={null} back={reportHref(display, days)} />
              )
            ) : report.ok && report.data.outdated && mode === "rules" && signedIn ? (
              // Made by an older version of the rules: check again, with the
              // normal progress, and fall back to it only if that fails. (Signed
              // out, an example shows as it is: a re-check needs an account.)
              <AnalysisRunner repo={report.data.repo} mode={mode} days={days} signedIn={signedIn} fallback={report.data} />
            ) : report.ok ? (
              <ReportView
                report={report.data}
                signedIn={signedIn}
                issues={
                  <SkeletonReveal fallback={<StarterIssuesSkeleton />}>
                    <IssuesSlot repo={report.data.repo} user={user} />
                  </SkeletonReveal>
                }
              />
            ) : report.error.code === "not_found" ? (
              <AnalysisRunner repo={name} mode={mode} days={days} signedIn={signedIn} ticket={ticket ?? undefined} />
            ) : (
              <ErrorPanel error={report.error} repo={name} retryHref={reportHref(name, days, mode)} />
            )}
          </div>
        </ViewTransition>
      </div>
      </div>
    </PageTransition>
  );
}

/** Above an example report, for signed-out visitors: what this is, and the way to their own. */
function ExampleNote() {
  return (
    <p className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-line-strong bg-panel-2 px-4 py-3 font-sans text-[0.9rem] text-muted" data-example-note>
      <span className="border border-blue px-2 py-0.5 font-mono text-[0.85rem] text-blue">Example report</span>
      <span className="min-w-0 flex-1">Sign in to check any repo you like.</span>
      <span className="flex flex-wrap gap-x-4 gap-y-5">
        <Link href="/signin" prefetch={false} className="text-link tap">sign in</Link>
        <Link href={EXAMPLES_PATH} className="text-link tap">more examples</Link>
      </span>
    </p>
  );
}

async function IssuesSlot({ repo, user }: { repo: string; user: SessionUser | null }) {
  const r = await starterIssues(repo, 6, await caller(user));
  return <StarterIssues issues={r.ok ? r.data.issues : "unavailable"} repo={repo} />;
}
