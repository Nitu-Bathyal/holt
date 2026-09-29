// What a signed-out visitor sees on a report that isn't one of the examples
// (lib/gate.ts): the verdict, its reason, the odds and one number, in the
// page's HTML so shared links and search engines get the answer. The rest of
// the report sits locked under one sign-in button: its real section names over
// neutral placeholders, never made-up numbers. With no report (a bot, or over
// the per-IP limit for signed-out checks) it offers a check after sign-in.
import Link from "next/link";
import { EXAMPLES_PATH } from "@/lib/examples";
import { statLines, timeAgo } from "@/lib/format";
import { signInHref } from "@/lib/gate";
import { fullStats } from "@/lib/repo-card";
import type { Report } from "@/lib/types";
import { CatFace } from "../cat-face";
import { OddsBar } from "../repo-card/odds-bar";
import { Skeleton, SkeletonCard, SkeletonText } from "../skeleton";
import { StatsGridSkeleton } from "./report-skeleton";
import { TONE, TONE_MOOD } from "./tone";
import { VerdictCat } from "./verdict-cat";

/** The report's sections, as the full page numbers them. */
const INSIDE = [
  { n: "01", title: "Starter issues", body: "Open issues you could take today, best first." },
  { n: "02", title: "What happened to outsiders", body: "How many outside pull requests got merged, and how fast people reply." },
  { n: "03", title: "Where newcomer work lands", body: "The folders where outside work gets merged, and where it doesn't." },
  { n: "04", title: "The evidence", body: "Every claim links to the GitHub thread it came from." },
];

/**
 * `land`: the check just finished on this page, so the answer lands as it does
 * on the full report (report-view.tsx, VerdictHero).
 */
export function ReportTeaser({ repo, report, back, land }: { repo: string; report: Report | null; back: string; land?: boolean }) {
  if (report) return <PartialReport report={report} back={back} land={land} />;
  const t = TONE.neutral;
  return (
    <div className="max-w-3xl space-y-6" data-teaser>
      <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
        <div className="p-5 pl-6 sm:p-8 sm:pl-10">
          <div className="flex items-center justify-between gap-4 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
            <span>not checked yet</span>
            <CatFace mood="thinking" blink className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
          </div>
          <h1 className="display mt-4 text-[2rem] [overflow-wrap:anywhere] sm:text-[3rem]">Is {repo} worth your time?</h1>
          <p className="mt-4 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink sm:text-[1.15rem]">
            Holt hasn&apos;t checked this repo recently. Sign in and it reads the recent pull requests now: do outsiders
            get replies, and does their work get merged? It takes about a minute.
          </p>
        </div>
      </div>

      <section aria-labelledby="teaser-signin" className="border border-line-strong bg-panel p-5 sm:p-8" data-signin-card>
        <h2 id="teaser-signin" className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.4rem]">
          Check this repo, free
        </h2>
        <p className="mt-2 max-w-2xl font-sans text-[0.98rem] text-muted">You get the verdict and the full report:</p>
        <ul className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-2">
          {INSIDE.map((s) => (
            <li key={s.n} className="bg-panel-2 p-4">
              <p className="text-[0.95rem] font-semibold tracking-tight">
                <span className="mr-2 text-[0.8rem] font-normal text-blue">{s.n}</span>
                {s.title}
              </p>
              <p className="mt-1 font-sans text-[0.89rem] text-muted">{s.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={signInHref(back)} prefetch={false} className="btn-primary">
            sign in to check it <span aria-hidden="true">→</span>
          </Link>
          <Link href={EXAMPLES_PATH} className="text-link inline-flex min-h-11 items-center text-[0.89rem]">
            [ read an example first ]
          </Link>
        </div>
      </section>
    </div>
  );
}

/** A real report, partly: the verdict, its reason, the odds and the first number; the rest locked. */
function PartialReport({ report, back, land }: { report: Report; back: string; land?: boolean }) {
  const t = TONE[report.tone];
  const lead = statLines(report.stats)[0];
  return (
    <div className="max-w-3xl space-y-10" data-teaser>
      <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg} ${land ? "land-bar" : ""}`} />
        <div className="p-5 pl-6 sm:p-8 sm:pl-10">
          <div className="flex items-center justify-between gap-4 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
            <span>verdict · rules report</span>
            {land ? (
              <VerdictCat mood={TONE_MOOD[report.tone]} className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
            ) : (
              <CatFace mood={TONE_MOOD[report.tone]} blink className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
            )}
          </div>
          <h1 className={`display mt-4 text-[2.6rem] sm:text-[4rem] ${t.text} ${land ? "land-stamp" : ""}`}>
            {report.headline}
            <span className="text-ink">.</span>
          </h1>
          <p className="mt-4 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink sm:text-[1.15rem]" data-line="reason">
            {report.verdict_line}
          </p>
          <div className="mt-6 max-w-2xl" data-odds>
            <OddsBar stats={fullStats(report.stats)} className="h-2.5" />
            {lead && (
              <p className="mt-3 font-sans text-[0.98rem] text-muted" data-line="lead-number">
                <span className={`mr-2 font-mono text-[1.25rem] font-semibold tracking-tight ${lead.tone === "neutral" ? "text-ink" : TONE[lead.tone].text}`}>{lead.big}</span>
                {lead.label}
              </p>
            )}
          </div>
          <p className="mt-5 text-[0.82rem] text-faint">
            checked <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
          </p>
        </div>
      </div>

      <section aria-label="The full report" className="relative" data-locked>
        {/* The report's own sections over placeholders: no numbers, real or made up, until sign-in. */}
        <div aria-hidden="true" inert className="pointer-events-none select-none space-y-10 blur-[3px] sk-still [mask-image:linear-gradient(#000_45%,transparent)]">
          {LOCKED.map((s) => (
            <div key={s.n} className="border-t border-line pt-8">
              <p className="mb-5 flex items-baseline gap-x-4">
                <span className="text-[0.8rem] text-blue">{s.n}</span>
                <span className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.4rem]">{s.title}</span>
              </p>
              {s.body}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 top-16 flex justify-center px-4 sm:top-24">
          <Link href={signInHref(back)} prefetch={false} className="btn-primary shadow-card" data-signin-card>
            sign in to see the full report <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}

const LOCKED = [
  {
    n: "01",
    title: "Starter issues",
    body: (
      <ul className="grid gap-3 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard className="hidden md:block" />
      </ul>
    ),
  },
  { n: "02", title: "What happened to outsiders", body: <StatsGridSkeleton /> },
  {
    n: "03",
    title: "Where newcomer work lands",
    body: (
      <span className="block space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </span>
    ),
  },
  { n: "04", title: "The evidence", body: <SkeletonText lines={4} last="40%" /> },
];
