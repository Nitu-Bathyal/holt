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
import { CompareCard } from "./compare-card";
import { CollapsibleSection } from "../ui/collapsible-section";
import { EvidenceList } from "./evidence-list";
import { HoltUsersLine } from "./holt-users-line";
import { PreflightLink } from "../preflight/preflight-link";
import { LandingMap } from "./landing-map";
import { PlaybookSection } from "./playbook-section";
import { ProjectSection } from "./project-section";
import { ProjectSidebar } from "./project-sidebar";
import { ReadmeSection } from "./readme-section";
import { ShareMenu } from "./share-bar";
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
    // No rule above a section: blocks are set apart by space and their headings,
    // so a section after a boxed block never shows the box's edge and a line.
    <section aria-labelledby={id} className={r.className} style={r.style}>
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
 * The verdict's name is a small tag in the page header (VerdictTag), so this
 * card starts with the reason. `land`: the answer just arrived on this page
 * (the expressive design plan, pattern 4): the cat reacts. A report read again
 * is still. The card is short on purpose: the reason, the numbers and what to
 * do fit in one screen, with the project and its issues starting just below.
 * `tag`: this page has no header to hold the tag (the recorded example), so it
 * shows here.
 */
export function VerdictHero({ report, reveal, land, tag }: { report: Report; reveal?: boolean; land?: boolean; tag?: boolean }) {
  // Every sentence here comes from the server, derived there from the verdict,
  // the counts and the rules, so the top of the page can't disagree with them
  // or with itself. The reason, the numbers, how long it takes (when known),
  // and what to do next.
  const advice = report.next_step.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (
    <div data-verdict-hero>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {tag && <VerdictTag report={report} />}
          {/* Where to begin reading: the line under it says what to do. */}
          <span className="text-[0.78rem] uppercase tracking-[0.08em] text-faint">Start here</span>
        </div>
        <span className={reveal ? "reveal" : ""}>
          {land ? (
            <VerdictCat mood={TONE_MOOD[report.tone]} className="text-[1rem] normal-case tracking-normal sm:text-[1.2rem]" />
          ) : (
            <CatFace mood={TONE_MOOD[report.tone]} blink className="text-[1rem] normal-case tracking-normal sm:text-[1.2rem]" />
          )}
        </span>
      </div>
      {/* What to do leads: it's the thing the visitor came for. The server's sentence can hold more than one
          piece of advice; the first is the headline, the rest are listed under "Also". */}
      <p className={`mt-3 max-w-3xl font-sans text-[1.25rem] font-semibold leading-snug tracking-tight text-ink sm:text-[1.5rem] ${reveal ? "reveal-lcp" : ""}`} data-line="next">
        {advice[0]}
      </p>
      {advice.length > 1 && (
        <ul className="mt-2 max-w-3xl list-disc space-y-0.5 pl-5 font-sans text-[0.95rem] leading-snug text-ink" aria-label="Also">
          {advice.slice(1).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 max-w-3xl font-sans text-[1rem] leading-snug text-muted sm:text-[1.05rem]" data-line="reason">
        {report.verdict_line}
      </p>

      {/* The wait is only here: the counts are in the stats card below, and how they were made is under "How this was counted". */}
      {report.how_long.length > 0 && (
        <div className="mt-4 border-t border-line pt-3" data-line="how-long">
          <h2 className="text-[0.85rem] text-faint">How long it usually takes</h2>
          <dl className="mt-1 grid max-w-3xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-sans text-[0.93rem] leading-snug text-ink">
            {report.how_long.map((l) => (
              <div key={l.topic} className="contents">
                <dt className="text-muted">{l.topic}</dt>
                <dd>{l.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <p className="text-[0.78rem] text-faint">
          {report.evidence_until && <>Data until {shortDate(report.evidence_until)} · </>}checked{" "}
          <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
        </p>
        <HowCounted report={report} />
      </div>
    </div>
  );
}

/**
 * The verdict's name as a quiet label: just the words, no box, no colour. It sits in the repo header's row of numbers (`inRow`, after a
 * thin divider) or, with no such row, beside Save. The page's one h1.
 */
export function VerdictTag({ report, inRow }: { report: Pick<Report, "headline" | "tone">; inRow?: boolean }) {
  // Coloured by the verdict (green, amber, orange), so the answer reads at a glance without growing.
  return (
    <h1 className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-[family-name:var(--font-archivo)] text-[0.8rem] font-medium leading-none ${TONE[report.tone].text} ${inRow ? "basis-full sm:basis-auto sm:border-l sm:border-line-strong sm:pl-4" : ""}`} data-verdict-tag>
      {report.headline}
    </h1>
  );
}

/** What was read, in a sentence a newcomer can follow. */
function lookedAt(r: Report): string {
  const smp = r.sample;
  const out = r.stats.outsider_attempts;
  const span = smp?.first_opened && smp.last_opened ? `, opened between ${shortDate(smp.first_opened)} and ${shortDate(smp.last_opened)}` : "";
  const read = smp ? `Holt read the ${smp.pull_requests} most recent pull requests on this repo${span}.` : "Holt read this repo's recent pull requests.";
  const outsiders = out > 0 ? ` ${out} came from people outside the team, like you, and had been open long enough to get an answer. Those are the ones that show how newcomers are treated.` : " None came from people outside the team that had been open long enough to count.";
  return read + outsiders;
}

/** "How this was counted": closed by default, for anyone who wants to check the working. */
function HowCounted({ report }: { report: Report }) {
  return (
    <details className="group max-w-2xl" data-how-counted>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-[0.6ch] text-[0.88rem] text-muted hover:text-ink focus-visible:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-faint">
          <span className="inline-block w-[1ch] text-center group-open:hidden">+</span>
          <span className="hidden w-[1ch] text-center group-open:inline-block">−</span>
        </span>
        How this was counted
      </summary>
      <dl className="mb-3 mt-1 space-y-4 border-l border-line-strong pl-4 sm:pl-5">
        <div>
          <dt className="text-[0.85rem] text-faint">what Holt read</dt>
          <dd className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{lookedAt(report)}</dd>
        </div>
        <div>
          <dt className="text-[0.85rem] text-faint">words used here</dt>
          <dd className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">
            A pull request (PR) is a change you propose to a project. Merged means the maintainers accepted it. An outsider is anyone who isn&apos;t on the project&apos;s team, like you.
          </dd>
        </div>
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      {!example && <Track event="report-view" data={{ verdict: report.verdict, mode: report.mode, repo }} />}
      <div className="min-w-0 space-y-8">
        <VerdictHero report={report} reveal={reveal} land={land} tag={example} />

        {(report.bottom_line || report.summary) && (
          <div className="border-l-2 border-blue pl-4" data-ai-explanation>
            <p className="text-[0.85rem] text-blue">AI explanation</p>
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

        {!viable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-line-strong p-4">
            <p className="font-sans text-[0.95rem] text-muted">Looking for somewhere friendlier to start?</p>
            <Link href="/find" className="text-link">Find a welcoming project</Link>
          </div>
        )}

        {/* The order follows the decision: what to work on, what happens to
            outside work, where it lands, how to contribute here, then the proof
            and, last, the project's own README. */}
        <Section id="issues" title={viable ? "Your first contribution" : "Starter issues"} note="open and unclaimed, best first" reveal={reveal ? 180 : undefined}>
          {issues}
        </Section>

        {/* What happened to outside pull requests, as a bar and its figures: the verdict's evidence at a glance. */}
        <StatsGrid stats={report.stats} reveal={reveal} land={land} />

        <Section id="landing" title="Where newcomer work lands" reveal={reveal ? 230 : undefined}>
          <LandingMap landing={report.landing} neverLanded={report.never_landed} repo={repo} />
        </Section>

        <HoltUsersLine stats={report.holt_users} />

        {report.about && <ProjectSection about={report.about} asks={report.asks} />}

        {/* Wide screens have these in the sidebar. */}
        {/* Phones: the merge plan where wide screens have it (under the
            project's numbers), and the sidebar's cards closed by default, so
            the page isn't twice as long as it is on a laptop. */}
        {report.mode === "rules" && (
          <div className="lg:hidden">
            <UpgradeCard repo={repo} signedIn={signedIn} />
          </div>
        )}
        {report.about && (
          <details className="group border-y border-line lg:hidden" data-more-about>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[0.88rem] text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
              <span>More about this project <span className="text-faint">· numbers, languages, contributors</span></span>
              <span aria-hidden="true" className="text-faint group-open:rotate-180">⌄</span>
            </summary>
            <div className="pb-4 pt-1">
              <ProjectSidebar about={report.about} repo={repo} />
            </div>
          </details>
        )}

        <PlaybookSection repo={repo} signedIn={signedIn} />

        {!example && <PreflightLink repo={repo} />}

        {report.evidence.length > 0 && (
          <CollapsibleSection id="evidence" title="The evidence" count={report.evidence.length} defaultOpen note="every claim links to GitHub">
            <EvidenceList evidence={report.evidence} />
          </CollapsibleSection>
        )}

        {/* Wide screens have this in the sidebar; here it follows the evidence it asks about. */}
        {!example && (
          <div className="lg:hidden">
            <VerdictFeedback report={report} />
          </div>
        )}

        {/* The project's own words, last: about the software, not about contributing to it. */}
        {report.about?.readme && <ReadmeSection markdown={report.about.readme} repo={repo} />}

        {/* A real report is shared from its header (next to save); the recorded example has no header. */}
        {example && (
          <div className="flex justify-end">
            <ShareMenu url={url} text={shareText} />
          </div>
        )}

        {!example && (
          <div className="lg:hidden">
            <CompareCard repo={repo} />
          </div>
        )}

        {/* The report's footer: for the maintainer who reads it to the end. */}
        {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}

      </div>

      <aside className="hidden space-y-4 lg:block" aria-label="About the project and more">
        {/* The merge plan sits right under Statistics, where it's seen, not under six cards. */}
        {report.about ? (
          <ProjectSidebar about={report.about} repo={repo} afterStats={report.mode === "rules" ? <UpgradeCard repo={repo} signedIn={signedIn} /> : undefined} />
        ) : (
          report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />
        )}
        {!example && <VerdictFeedback report={report} />}
        {!example && <CompareCard repo={repo} />}
      </aside>
    </div>
  );
}
