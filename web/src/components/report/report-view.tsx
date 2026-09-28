// The full report. Shared by the server page (cached report) and the client
// runner (report that just finished streaming), so no server-only imports.
import Link from "next/link";
import { humanHours, mergeTone, noReplyTone, pct, shortDate, timeAgo } from "@/lib/format";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { SITE_URL } from "@/lib/site";
import type { Report, Tone } from "@/lib/types";
import { CatFace } from "../cat-face";
import { Track } from "../track";
import { badgeOffered } from "@/lib/badge";
import { BadgeSnippet } from "./badge-snippet";
import { EvidenceList } from "./evidence-list";
import { HoltUsersLine } from "./holt-users-line";
import { PreflightLink } from "../preflight/preflight-link";
import { LandingMap } from "./landing-map";
import { PlaybookSection } from "./playbook-section";
import { ShareBar } from "./share-bar";
import { TONE, TONE_MOOD } from "./tone";
import { UpgradeCard } from "./upgrade-card";
import { VerdictFeedback } from "./verdict-feedback";

/** Delay for a part of the report that fades in when an analysis finishes on the page. */
const step = (reveal: boolean | undefined, ms: number) =>
  reveal ? { className: "reveal", style: { ["--d0" as string]: `${ms}ms` } } : { className: "", style: undefined };

export function Section({ title, id, children, note, reveal }: { title: string; id: string; children: React.ReactNode; note?: React.ReactNode; reveal?: number }) {
  const r = step(reveal != null, reveal ?? 0);
  return (
    <section aria-labelledby={id} className={`border-t border-line pt-8 ${r.className}`} style={r.style}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-[1.2rem] font-semibold tracking-tight sm:text-[1.35rem]">{title}</h2>
        {note && <span className="font-sans text-[0.89rem] text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

type Figure = { key: string; value: string; label: string; tone: Tone | "neutral" };

/** The four numbers the verdict rests on, in the order people ask about them. */
function keyFigures(s: Report["stats"]): Figure[] {
  const tried = s.outsider_attempts;
  const out: Figure[] = [
    { key: "merged", value: `${s.outsider_merged} of ${tried}`, label: "outside PRs merged", tone: tried ? mergeTone(pct(s.outsider_merged, tried)) : "neutral" },
    {
      key: "reply",
      value: s.median_first_response_hours == null ? "none" : humanHours(s.median_first_response_hours),
      label: "typical first reply",
      tone: s.median_first_response_hours == null ? "bad" : "neutral",
    },
  ];
  if (tried) out.push({ key: "noreply", value: `${s.no_reply} of ${tried}`, label: "got no reply", tone: noReplyTone(pct(s.no_reply, tried)) });
  out.push({ key: "first", value: String(s.first_time_merged_authors), label: "first PRs merged", tone: "neutral" });
  return out;
}

export function VerdictHero({ report, reveal }: { report: Report; reveal?: boolean }) {
  // The verdict, its reason and where to start come from the server, derived
  // there from the counts and the rules, so the top of the page can't disagree
  // with them. The figures are those same counts.
  const t = TONE[report.tone];
  const figures = keyFigures(report.stats);
  const s = report.sample;
  return (
    <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
      <div className="p-5 pl-6 sm:p-8 sm:pl-10">
        <div className="flex items-start justify-between gap-4">
          {/* The largest paint: on phones it never animates, on desktop it only moves. */}
          <h1 className={`display text-[2.4rem] sm:text-[3.6rem] ${t.text} ${reveal ? "reveal-lcp" : ""}`}>
            {report.headline}
            <span className="text-ink">.</span>
          </h1>
          <span className={`mt-2 shrink-0 ${reveal ? "reveal" : ""}`}>
            <CatFace mood={TONE_MOOD[report.tone]} blink className="text-[1.1rem] sm:text-[1.4rem]" />
          </span>
        </div>
        <p className={`mt-3 max-w-2xl font-sans text-[1.08rem] leading-relaxed text-ink sm:text-[1.15rem] ${reveal ? "reveal-lcp" : ""}`} data-line="reason">
          {report.verdict_line}
        </p>

        <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden border border-line bg-line sm:grid-cols-4" data-line="numbers">
          {figures.map((f) => (
            <div key={f.key} className="flex flex-col-reverse justify-end bg-panel px-4 py-3.5">
              <dt className="mt-0.5 font-sans text-[0.86rem] text-muted">{f.label}</dt>
              <dd className={`text-[1.3rem] font-semibold tabular-nums tracking-tight ${f.tone === "neutral" ? "text-ink" : TONE[f.tone].text}`}>{f.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 max-w-2xl font-sans text-[1rem] leading-relaxed text-ink" data-line="next">
          <span className="mr-2 font-mono text-[0.82rem] uppercase tracking-[0.08em] text-faint">Where to start</span>
          {report.next_step}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-4 text-[0.84rem] text-faint">
          {s?.first_opened && s.last_opened && (
            <span>
              {s.pull_requests} pull requests, opened {shortDate(s.first_opened)} – {shortDate(s.last_opened)}
            </span>
          )}
          <span>replies counted within {report.days} days</span>
          <span>
            checked <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
          </span>
        </div>
        <HowCounted report={report} />
      </div>
    </div>
  );
}

/** "How we counted": closed by default, for anyone who wants to check the working. */
function HowCounted({ report }: { report: Report }) {
  return (
    <details className="group mt-2 max-w-2xl" data-how-counted>
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-[0.6ch] text-[0.86rem] text-muted hover:text-ink focus-visible:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        How we counted
      </summary>
      <dl className="mt-2 space-y-4 border-l border-line-strong pl-4 sm:pl-5">
        {report.counted.map((c) => (
          <div key={c.topic}>
            <dt className="text-[0.84rem] text-faint">{c.topic}</dt>
            <dd className="mt-1 font-sans text-[0.92rem] leading-relaxed text-muted">{c.text}</dd>
          </div>
        ))}
        {report.asks.length > 0 && (
          <div>
            <dt className="text-[0.84rem] text-faint">Where the advice comes from</dt>
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
  cla: "A CLA bot asking an outsider to sign",
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
  /** A recorded example: shares its own link, and takes no votes, badge or view count. */
  example?: boolean;
}) {
  const repo = report.repo;
  const url = example ? `${SITE_URL}${EXAMPLE_PATH}` : `${SITE_URL}/${repo}`;
  const shareText = example ? `An example AI report on Holt, for ${repo}.` : `${repo} on Holt: ${report.headline}.`;
  const viable = report.verdict === "viable";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
      {!example && <Track event="report-view" data={{ verdict: report.verdict, mode: report.mode, repo }} />}
      <div className="min-w-0 space-y-10">
        <div className="space-y-3">
          <VerdictHero report={report} reveal={reveal} />
          <HoltUsersLine stats={report.holt_users} />
        </div>

        {(report.bottom_line || report.summary) && (
          <div className="border-l-2 border-blue pl-5" data-ai-explanation>
            <p className="text-[0.8rem] uppercase tracking-[0.08em] text-blue">AI explanation</p>
            {report.bottom_line && (
              <p className="mt-2 font-sans text-[1.12rem] font-medium leading-relaxed text-ink" data-bottom-line>
                {report.bottom_line}
              </p>
            )}
            {report.summary && <p className="mt-2 font-sans text-[1.02rem] leading-relaxed text-ink">{report.summary}</p>}
            <p className="mt-2 text-[0.8rem] text-faint">
              Written by {report.cost?.model ?? "a model"} from the evidence below. The rules picked the verdict.
            </p>
          </div>
        )}

        {!viable && (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-line-strong p-4">
            <p className="font-sans text-[0.95rem] text-muted">Looking for a project that answers newcomers?</p>
            <Link href="/find" className="bracket-link">[ find one → ]</Link>
          </div>
        )}

        <PlaybookSection repo={repo} signedIn={signedIn} />

        <Section id="issues" title={viable ? "Good first issues" : "Open issues"} note="open and unclaimed" reveal={reveal ? 180 : undefined}>
          {issues}
        </Section>

        {!example && <PreflightLink repo={repo} />}

        <Section id="landing" title="Where outside PRs get merged" reveal={reveal ? 230 : undefined}>
          <LandingMap landing={report.landing} neverLanded={report.never_landed} />
        </Section>

        <Section id="evidence" title="Recent outside PRs" note="each one links to GitHub" reveal={reveal ? 280 : undefined}>
          <EvidenceList evidence={report.evidence} />
        </Section>

        {!example && <VerdictFeedback report={report} />}

        <div className="space-y-4 lg:hidden">
          {report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />}
          <ShareBar url={url} text={shareText} />
          {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}
        </div>
      </div>

      <aside className="hidden lg:block" aria-label="More">
        <div className="sticky top-24 space-y-6">
          {report.mode === "rules" && <UpgradeCard repo={repo} signedIn={signedIn} />}
          <div>
            <p className="mb-2 text-[0.78rem] uppercase tracking-[0.08em] text-faint">Share</p>
            <ShareBar url={url} text={shareText} />
          </div>
          {!example && <BadgeSnippet repo={repo} offered={badgeOffered(report)} />}
          {!example && (
            <Link href={`/compare?repos=${repo}`} className="block text-[0.87rem] text-muted hover:text-ink">
              Compare with another repo →
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
