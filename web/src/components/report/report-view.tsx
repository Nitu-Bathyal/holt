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
import { LandingMap } from "./landing-map";
import { PlaybookSection } from "./playbook-section";
import { ShareBar } from "./share-bar";
import { StatsGrid } from "./stats-grid";
import { TONE, TONE_MOOD } from "./tone";
import { UpgradeCard } from "./upgrade-card";
import { VerdictFeedback } from "./verdict-feedback";

/** Delay for a part of the report that fades in when an analysis finishes on the page. */
const step = (reveal: boolean | undefined, ms: number) =>
  reveal ? { className: "reveal", style: { ["--d0" as string]: `${ms}ms` } } : { className: "", style: undefined };

export function Section({ n, title, id, children, note, reveal }: { n: string; title: string; id: string; children: React.ReactNode; note?: React.ReactNode; reveal?: number }) {
  const r = step(reveal != null, reveal ?? 0);
  return (
    <section aria-labelledby={id} className={`border-t border-line pt-8 ${r.className}`} style={r.style}>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[0.72rem] text-blue">{n}</span>
        <h2 id={id} className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.4rem]">{title}</h2>
        {note && <span className="font-sans text-[0.85rem] text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function VerdictHero({ report, reveal }: { report: Report; reveal?: boolean }) {
  // Every sentence here comes from the server, derived there from the verdict,
  // the counts and the rules, so the top of the page can't disagree with them
  // or with itself. Three lines: the reason, the numbers, what to do next.
  const t = TONE[report.tone];
  return (
    <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
      <div className="p-5 pl-6 sm:p-8 sm:pl-10">
        <div className="flex items-center justify-between gap-4 text-[0.72rem] uppercase tracking-[0.08em] text-faint">
          <span>verdict · {report.mode === "ai" ? "AI report" : "rules report"} · {report.days}-day budget</span>
          <span className={reveal ? "reveal" : ""}>
            <CatFace mood={TONE_MOOD[report.tone]} blink className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
          </span>
        </div>
        {/* The largest paint: on phones it never animates, on desktop it only moves. */}
        <h1 className={`display mt-4 text-[2.6rem] sm:text-[4rem] ${t.text} ${reveal ? "reveal-lcp" : ""}`}>
          {report.headline}
          <span className="text-ink">.</span>
        </h1>
        <p className={`mt-4 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink sm:text-[1.15rem] ${reveal ? "reveal-lcp" : ""}`} data-line="reason">
          {report.verdict_line}
        </p>

        <dl className="mt-6 max-w-2xl border-t border-dashed border-line-strong">
          <TopLine label="the numbers" name="numbers">
            <p>{report.numbers_line}</p>
            {report.first_timer_line && (
              <p className="mt-2 font-medium" data-line="first-timers">
                {report.first_timer_line}
              </p>
            )}
          </TopLine>
          <TopLine label="what to do" name="next">
            <p>{report.next_step}</p>
          </TopLine>
        </dl>

        <HowCounted report={report} />

        <p className="mt-5 text-[0.74rem] text-faint">
          {report.evidence_until && <>data until {shortDate(report.evidence_until)} · </>}checked{" "}
          <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
        </p>
      </div>
    </div>
  );
}

function TopLine({ label, name, children }: { label: string; name: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-dashed border-line-strong py-4 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-5" data-line={name}>
      <dt className="text-[0.78rem] text-faint sm:pt-[0.2rem]">{label}</dt>
      <dd className="font-sans text-[0.98rem] leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

/** "How this was counted": closed by default, for anyone who wants to check the working. */
function HowCounted({ report }: { report: Report }) {
  return (
    <details className="group mt-4 max-w-2xl" data-how-counted>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-[0.6ch] text-[0.82rem] text-muted hover:text-ink focus-visible:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-green">
          [<span className="inline-block w-[1ch] text-center group-open:hidden">+</span>
          <span className="hidden w-[1ch] text-center group-open:inline-block">−</span>]
        </span>
        how this was counted
      </summary>
      <dl className="mt-2 space-y-4 border-l border-line-strong pl-4 sm:pl-5">
        {report.counted.map((c) => (
          <div key={c.topic}>
            <dt className="text-[0.78rem] text-faint">{c.topic.toLowerCase()}</dt>
            <dd className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{c.text}</dd>
          </div>
        ))}
        {report.unknowns.length > 0 && (
          <div>
            <dt className="text-[0.78rem] text-faint">what Holt couldn&apos;t check</dt>
            {report.unknowns.map((u) => (
              <dd key={u} className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{u}</dd>
            ))}
          </div>
        )}
        {report.asks.length > 0 && (
          <div>
            <dt className="text-[0.78rem] text-faint">where the advice comes from</dt>
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
  cla: "A CLA bot asking an outside contributor to sign",
  dco: "CONTRIBUTING, on signing off commits",
  issue_first: "CONTRIBUTING, on opening an issue first",
};

export function ReportView({
  report,
  issues,
  signedIn,
  reveal,
  example,
}: {
  report: Report;
  /** The starter-issues block: streamed by the server page, fetched by the runner. */
  issues: React.ReactNode;
  signedIn: boolean;
  /** The report just arrived on this page: step its parts in. A server-rendered report doesn't wait. */
  reveal?: boolean;
  /** A recorded example (/example-ai-report): shares its own link, and takes no votes, badge or view count. */
  example?: boolean;
}) {
  const repo = report.repo;
  const url = example ? `${SITE_URL}${EXAMPLE_PATH}` : `${SITE_URL}/${repo}`;
  const shareText = example ? `An example AI report on Holt, for ${repo}.` : `${repo} on Holt: ${report.headline}.`;
  const viable = report.verdict === "viable";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      {!example && <Track event="report-view" data={{ verdict: report.verdict, mode: report.mode, repo }} />}
      <div className="min-w-0 space-y-10">
        <VerdictHero report={report} reveal={reveal} />

        {(report.bottom_line || report.summary) && (
          <div className="border-l-2 border-blue pl-5" data-ai-explanation>
            <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">AI explanation</p>
            {report.bottom_line && (
              <p className="mt-2 font-sans text-[1.12rem] font-medium leading-relaxed text-ink" data-bottom-line>
                {report.bottom_line}
              </p>
            )}
            {report.summary && <p className="mt-2 font-sans text-[1.02rem] leading-relaxed text-ink">{report.summary}</p>}
            <p className="mt-2 text-[0.72rem] text-faint">
              Written by {report.cost?.model ?? "a model"} from the evidence below. The verdict itself comes from fixed rules.
            </p>
          </div>
        )}

        <div className="lg:hidden">
          <ShareBar url={url} text={shareText} />
        </div>

        {!viable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-line-strong p-4">
            <p className="font-sans text-[0.95rem] text-muted">Looking for somewhere friendlier to start?</p>
            <Link href="/find" className="bracket-link">[ find a welcoming project → ]</Link>
          </div>
        )}

        <PlaybookSection repo={repo} signedIn={signedIn} />

        <Section n="01" id="issues" title={viable ? "Your first contribution" : "Starter issues"} note="open and unclaimed, best first" reveal={reveal ? 180 : undefined}>
          {issues}
        </Section>

        <Section n="02" id="numbers" title="What happened to outside contributors">
          <StatsGrid stats={report.stats} reveal={reveal} />
          <HoltUsersLine stats={report.holt_users} />
        </Section>

        <Section n="03" id="landing" title="Where newcomer work lands" reveal={reveal ? 230 : undefined}>
          <LandingMap landing={report.landing} neverLanded={report.never_landed} />
        </Section>

        {!example && <VerdictFeedback report={report} />}

        <Section n="04" id="evidence" title="The evidence" note="every claim links to GitHub" reveal={reveal ? 280 : undefined}>
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
            <p className="mb-3 text-[0.72rem] uppercase tracking-[0.08em] text-faint">Share this report</p>
            <ShareBar url={url} text={shareText} />
          </div>
          {report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />}
          {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}
          {!example && (
            <Link href={`/compare?repos=${repo}`} className="block text-[0.8rem] text-muted hover:text-ink">
              [ compare with another repo → ]
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
