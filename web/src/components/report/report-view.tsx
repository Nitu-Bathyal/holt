// The full report. Shared by the server page (cached report) and the client
// runner (report that just finished streaming), so no server-only imports.
import Link from "next/link";
import { shortDate, timeAgo } from "@/lib/format";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { SITE_URL } from "@/lib/site";
import type { Report } from "@/lib/types";
import { CatFace } from "../cat-face";
import { Track } from "../track";
import { badgeOffered } from "@/lib/badge";
import { BadgeSnippet } from "./badge-snippet";
import { EvidenceList } from "./evidence-list";
import { HoltUsersLine } from "./holt-users-line";
import { PreflightLink } from "../preflight/preflight-link";
import { LandingMap } from "./landing-map";
import { PlaybookSection } from "./playbook-section";
import { ProjectSection } from "./project-section";
import { ShareBar } from "./share-bar";
import { StatsGrid } from "./stats-grid";
import { TONE, TONE_MOOD } from "./tone";
import { UpgradeCard } from "./upgrade-card";
import { VerdictCat } from "./verdict-cat";
import { VerdictFeedback } from "./verdict-feedback";

/** Delay for a part of the report that fades in when an analysis finishes on the page. */
const step = (reveal: boolean | undefined, ms: number) =>
  reveal ? { className: "reveal", style: { ["--d0" as string]: `${ms}ms` } } : { className: "", style: undefined };

export function Section({ n, title, id, children, note, reveal }: { n?: string; title: string; id: string; children: React.ReactNode; note?: React.ReactNode; reveal?: number }) {
  const r = step(reveal != null, reveal ?? 0);
  return (
    <section aria-labelledby={id} className={`border-t border-line pt-5 ${r.className}`} style={r.style}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {n && <span className="text-[0.78rem] text-blue">{n}</span>}
        <h2 id={id} className="text-[1.05rem] font-semibold tracking-tight sm:text-[1.15rem]">{title}</h2>
        {note && <span className="font-sans text-[0.89rem] text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * `land`: the answer just arrived on this page (the expressive design plan,
 * pattern 4): the verdict's bar draws and the cat reacts. A report read again
 * is still. The card is short on purpose: the verdict, the reason, the
 * numbers and what to do fit in one screen, with the project and its issues
 * starting just below, so a visitor scrolls as little as possible.
 */
export function VerdictHero({ report, reveal, land }: { report: Report; reveal?: boolean; land?: boolean }) {
  // Every sentence here comes from the server, derived there from the verdict,
  // the counts and the rules, so the top of the page can't disagree with them
  // or with itself. The reason, the numbers, how long it takes (when known),
  // and what to do next.
  const t = TONE[report.tone];
  return (
    <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg} ${land ? "land-bar" : ""}`} />
      <div className="p-4 pl-5 sm:p-5 sm:pl-7">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className={`inline-flex items-center gap-2 border px-2.5 py-1 text-[0.95rem] font-semibold sm:text-[1rem] ${t.text} ${t.border} ${t.soft}`}>
              <span aria-hidden="true" className={`size-1.5 rounded-full ${t.bg}`} />
              {report.headline}
            </h1>
            <span className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">{report.mode === "ai" ? "AI report" : "rules report"} · {report.days}-day budget</span>
          </div>
          <span className={reveal ? "reveal" : ""}>
            {land ? (
              <VerdictCat mood={TONE_MOOD[report.tone]} className="text-[1rem] normal-case tracking-normal sm:text-[1.2rem]" />
            ) : (
              <CatFace mood={TONE_MOOD[report.tone]} blink className="text-[1rem] normal-case tracking-normal sm:text-[1.2rem]" />
            )}
          </span>
        </div>
        <p className={`mt-3 max-w-3xl font-sans text-[1rem] leading-snug text-ink sm:text-[1.05rem] ${reveal ? "reveal-lcp" : ""}`} data-line="reason">
          {report.verdict_line}
        </p>

        <dl className="mt-3 grid gap-x-8 border-t border-dashed border-line-strong sm:grid-cols-2">
          <TopLine label="the numbers" name="numbers">
            <p>{report.numbers_line}</p>
            {report.first_timer_line && (
              <p className="mt-1.5 font-medium" data-line="first-timers">
                {report.first_timer_line}
              </p>
            )}
          </TopLine>
          {report.how_long.length > 0 && (
            <TopLine label="how long" name="how-long">
              <ul className="space-y-1">
                {report.how_long.map((l) => (
                  <li key={l.topic}>
                    <span className="text-faint">{l.topic}:</span> {l.text}
                  </li>
                ))}
              </ul>
            </TopLine>
          )}
          <TopLine label="what to do" name="next">
            <p>{report.next_step}</p>
          </TopLine>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          <p className="text-[0.78rem] text-faint">
            {report.evidence_until && <>data until {shortDate(report.evidence_until)} · </>}checked{" "}
            <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
          </p>
          <HowCounted report={report} />
        </div>
      </div>
    </div>
  );
}

function TopLine({ label, name, children }: { label: string; name: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-3" data-line={name}>
      <dt className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">{label}</dt>
      <dd className="font-sans text-[0.93rem] leading-snug text-ink">{children}</dd>
    </div>
  );
}

/** "How this was counted": closed by default, for anyone who wants to check the working. */
function HowCounted({ report }: { report: Report }) {
  return (
    <details className="group max-w-2xl" data-how-counted>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-[0.6ch] text-[0.88rem] text-muted hover:text-ink focus-visible:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-green">
          [<span className="inline-block w-[1ch] text-center group-open:hidden">+</span>
          <span className="hidden w-[1ch] text-center group-open:inline-block">−</span>]
        </span>
        how this was counted
      </summary>
      <dl className="mb-3 mt-1 space-y-4 border-l border-line-strong pl-4 sm:pl-5">
        {report.counted.map((c) => (
          <div key={c.topic}>
            <dt className="text-[0.85rem] text-faint">{c.topic.toLowerCase()}</dt>
            <dd className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{c.text}</dd>
          </div>
        ))}
        {report.unknowns.length > 0 && (
          <div>
            <dt className="text-[0.85rem] text-faint">what Holt couldn&apos;t check</dt>
            {report.unknowns.map((u) => (
              <dd key={u} className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{u}</dd>
            ))}
          </div>
        )}
        {report.asks.length > 0 && (
          <div>
            <dt className="text-[0.85rem] text-faint">where the advice comes from</dt>
            {report.asks.map((a) => (
              <dd key={a.code} className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">
                <a className="text-link" href={a.url} target="_blank" rel="noopener noreferrer">
                  {ASK_SOURCE[a.code]}
                </a>
              </dd>
            ))}
          </div>
        )}
      </dl>
    </details>
  );
}

const ASK_SOURCE: Record<Report["asks"][number]["code"], string> = {
  ticket_first: "The bot closing pull requests with no accepted ticket",
  no_ai_prs: "Where the project turns down AI-written pull requests",
  ok_to_test: "A pull request waiting for a maintainer to approve tests",
  sig_team: "A pull request labelled with its team",
  cla: "A CLA bot asking an outsider to sign",
  dco: "CONTRIBUTING, on signing off commits",
  issue_first: "CONTRIBUTING, on opening an issue first",
  ai_disclosure: "Where the project asks you to say whether you used AI",
  duplicates: "A pull request closed as a duplicate",
  stale_bot: "Where a bot closes quiet pull requests",
};

export function ReportView({
  report,
  issues,
  signedIn,
  reveal,
  land,
  example,
}: {
  report: Report;
  /** The starter-issues block: streamed by the server page, fetched by the runner. */
  issues: React.ReactNode;
  signedIn: boolean;
  /** The report just arrived on this page: step its parts in. A server-rendered report doesn't wait. */
  reveal?: boolean;
  /** The check ran while the visitor watched: the answer lands (VerdictHero) and the numbers count up. */
  land?: boolean;
  /** A recorded example (/example-ai-report): shares its own link, and takes no votes, badge or view count. */
  example?: boolean;
}) {
  const repo = report.repo;
  const url = example ? `${SITE_URL}${EXAMPLE_PATH}` : `${SITE_URL}/${repo}`;
  const shareText = example ? `An example AI report on Holt, for ${repo}.` : `${repo} on Holt: ${report.headline}.`;
  const viable = report.verdict === "viable";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      {!example && <Track event="report-view" data={{ verdict: report.verdict, mode: report.mode, repo }} />}
      <div className="min-w-0 space-y-6">
        <VerdictHero report={report} reveal={reveal} land={land} />

        {(report.bottom_line || report.summary) && (
          <div className="border-l-2 border-blue pl-4" data-ai-explanation>
            <p className="text-[0.75rem] uppercase tracking-[0.08em] text-blue">AI explanation</p>
            {report.bottom_line && (
              <p className="mt-1.5 font-sans text-[1rem] font-medium leading-snug text-ink" data-bottom-line>
                {report.bottom_line}
              </p>
            )}
            {report.summary && <p className="mt-1.5 font-sans text-[0.93rem] leading-snug text-ink">{report.summary}</p>}
            <p className="mt-1.5 text-[0.75rem] text-faint">
              Written by AI from the evidence below. The rules picked the verdict.
            </p>
          </div>
        )}

        {report.about && <ProjectSection about={report.about} />}

        <div className="lg:hidden">
          <ShareBar url={url} text={shareText} />
        </div>

        {!viable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-line-strong p-4">
            <p className="font-sans text-[0.95rem] text-muted">Looking for somewhere friendlier to start?</p>
            <Link href="/find" className="bracket-link">[ find a welcoming project → ]</Link>
          </div>
        )}

        <Section id="issues" title={viable ? "Your first contribution" : "Starter issues"} note="open and unclaimed, best first" reveal={reveal ? 180 : undefined}>
          {issues}
        </Section>

        <PlaybookSection repo={repo} signedIn={signedIn} />

        {!example && <PreflightLink repo={repo} />}

        <Section id="numbers" title="What happened to outsiders">
          <StatsGrid stats={report.stats} reveal={reveal} land={land} />
          <HoltUsersLine stats={report.holt_users} />
        </Section>

        <Section id="landing" title="Where newcomer work lands" reveal={reveal ? 230 : undefined}>
          <LandingMap landing={report.landing} neverLanded={report.never_landed} />
        </Section>

        {!example && <VerdictFeedback report={report} />}

        <Section id="evidence" title="The evidence" note="every claim links to GitHub" reveal={reveal ? 280 : undefined}>
          <EvidenceList evidence={report.evidence} />
        </Section>

        <div className="lg:hidden space-y-4">
          {report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />}
          {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}
        </div>
      </div>

      <aside className="hidden lg:block" aria-label="Share and more">
        <div className="sticky top-24 space-y-4">
          <div className="panel p-4">
            <p className="mb-3 text-[0.8rem] uppercase tracking-[0.08em] text-faint">Share this report</p>
            <ShareBar url={url} text={shareText} />
          </div>
          {report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />}
          {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}
          {!example && (
            <Link href={`/compare?repos=${repo}`} className="block text-[0.87rem] text-muted hover:text-ink">
              [ compare with another repo → ]
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
