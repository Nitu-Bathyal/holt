// What a signed-out visitor sees on a report that isn't one of the examples
// (lib/gate.ts): the verdict and its reason, in the page's HTML so shared
// links and search engines get the answer, and one sign-in card for the rest.
// It never starts a check: with no report yet it only offers one.
import Link from "next/link";
import { EXAMPLES_PATH } from "@/lib/examples";
import { timeAgo } from "@/lib/format";
import { signInHref } from "@/lib/gate";
import type { Report } from "@/lib/types";
import { CatFace } from "../cat-face";
import { TONE, TONE_MOOD } from "./tone";

/** The report's sections, as the full page numbers them. */
const INSIDE = [
  { n: "01", title: "Starter issues", body: "Open issues you could take today, best first." },
  { n: "02", title: "What happened to outsiders", body: "How many outside pull requests got merged, and how fast people reply." },
  { n: "03", title: "Where newcomer work lands", body: "The folders where outside work gets merged, and where it doesn't." },
  { n: "04", title: "The evidence", body: "Every claim links to the GitHub thread it came from." },
];

export function ReportTeaser({ repo, report, back }: { repo: string; report: Report | null; back: string }) {
  const t = report ? TONE[report.tone] : TONE.neutral;
  return (
    <div className="max-w-6xl space-y-6" data-teaser>
      <div className="relative overflow-hidden border border-line-strong bg-panel shadow-card" data-verdict-hero>
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
        <div className="p-5 pl-6 sm:p-8 sm:pl-10">
          <div className="flex items-center justify-between gap-4 text-[0.8rem] uppercase tracking-[0.08em] text-faint">
            <span>{report ? "verdict · rules report" : "not checked yet"}</span>
            <CatFace mood={report ? TONE_MOOD[report.tone] : "thinking"} blink className="text-[1.1rem] normal-case tracking-normal sm:text-[1.5rem]" />
          </div>
          {report ? (
            <>
              <h1 className={`display mt-4 text-[2.6rem] sm:text-[4rem] ${t.text}`}>
                {report.headline}
                <span className="text-ink">.</span>
              </h1>
              <p className="mt-4 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink sm:text-[1.15rem]" data-line="reason">
                {report.verdict_line}
              </p>
              <p className="mt-5 text-[0.82rem] text-faint">
                checked <time dateTime={report.generated_at} suppressHydrationWarning>{timeAgo(report.generated_at)}</time>
              </p>
            </>
          ) : (
            <>
              <h1 className="display mt-4 text-[2rem] [overflow-wrap:anywhere] sm:text-[3rem]">Is {repo} worth your time?</h1>
              <p className="mt-4 max-w-2xl font-sans text-[1.05rem] leading-relaxed text-ink sm:text-[1.15rem]">
                Holt hasn&apos;t checked this repo recently. Sign in and it reads the recent pull requests now: do outsiders
                get replies, and does their work get merged? It takes about a minute.
              </p>
            </>
          )}
        </div>
      </div>

      <section aria-labelledby="teaser-signin" className="border border-line-strong bg-panel p-5 sm:p-8" data-signin-card>
        <h2 id="teaser-signin" className="text-[1.25rem] font-semibold tracking-tight sm:text-[1.4rem]">
          {report ? "See why, and where to start" : "Check this repo, free"}
        </h2>
        <p className="mt-2 max-w-2xl font-sans text-[0.98rem] text-muted">
          {report ? "The full report is free with an account. Inside:" : "You get the verdict and the full report:"}
        </p>
        <ul className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
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
            {report ? "sign in to see the full report" : "sign in to check it"} <span aria-hidden="true">→</span>
          </Link>
          <Link href={EXAMPLES_PATH} className="text-link inline-flex min-h-11 items-center text-[0.89rem]">
            [ read an example first ]
          </Link>
        </div>
      </section>
    </div>
  );
}
