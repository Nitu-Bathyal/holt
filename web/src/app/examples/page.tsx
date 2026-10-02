import type { Metadata } from "next";
import Link from "next/link";
import { PageTransition } from "@/components/motion/page-transition";
import { ComingSoon } from "@/components/coming-soon";
import { PageHead } from "@/components/page-head";
import { VerdictPill } from "@/components/report/verdict-pill";
import { getReport, mergePlansAvailable } from "@/lib/api";
import { compact } from "@/lib/discover";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { EXAMPLES, EXAMPLES_PATH } from "@/lib/examples";
import { HOME } from "@/lib/home";
import { EXAMPLE_PLAN } from "@/lib/merge-plan";
import { currentUser } from "@/lib/session";
import type { Tone } from "@/lib/types";

export const metadata: Metadata = {
  title: "Example reports",
  description: "Full Holt reports on real repos, some worth your time, some not, some without enough evidence, plus a merge plan.",
  alternates: { canonical: EXAMPLES_PATH },
};

interface Row {
  href: string;
  repo: string;
  plan?: boolean;
  /** Today's verdict as the server words it; none when the report isn't cached. */
  verdict?: { headline: string; tone: Tone };
  language?: string;
  stars?: number;
  why: string;
}

// The curated examples (lib/examples.ts), each with today's verdict from the
// cache, as one calm list: a place to pick one and open it. Reading the cache
// starts no checks.
export default async function ExamplesPage() {
  const [reports, user, mergePlans] = await Promise.all([Promise.all(EXAMPLES.map((e) => getReport(e.repo))), currentUser(), mergePlansAvailable()]);
  const planRepo = EXAMPLES.find((e) => e.repo === EXAMPLE_PLAN.repo);
  const rows: Row[] = [
    ...EXAMPLES.map((e, i) => {
      const r = reports[i];
      return { href: `/${e.repo}`, repo: e.repo, verdict: r.ok ? r.data : undefined, language: e.language, stars: e.stars, why: e.why };
    }),
    {
      href: EXAMPLE_PATH,
      repo: EXAMPLE_PLAN.repo,
      plan: true,
      verdict: EXAMPLE_PLAN.verdict,
      language: planRepo?.language,
      stars: planRepo?.stars,
      why: "A plan for your first pull request, citing the PRs behind each step.",
    },
  ];

  return (
    <PageTransition>
      <>
        <PageHead compact>
          <p className="ls-kicker text-blue">examples</p>
          <h1 className="display text-[clamp(1.8rem,4vw,2.6rem)]">See what a report tells you.</h1>
        </PageHead>

        <div className="wrap py-8 sm:py-10">
          <ul className="border-t border-line">
            {rows.map((r) => (
              <li key={r.href} className="border-b border-line">
                <Link
                  href={r.href}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-2 py-4 transition-colors hover:bg-section-alt sm:px-4 lg:grid-cols-[minmax(0,15rem)_12rem_10rem_minmax(0,1fr)_1rem] lg:gap-x-6"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold tracking-tight text-ink" title={r.repo}>
                      {r.repo}
                    </span>
                    {r.plan && <span className="shrink-0 border border-blue/60 px-1.5 text-[0.72rem] leading-5 text-blue">merge plan</span>}
                    {r.plan && !mergePlans && <ComingSoon small />}
                  </span>
                  <span className="justify-self-end lg:justify-self-start">
                    {r.verdict && <VerdictPill headline={r.verdict.headline} tone={r.verdict.tone} className="whitespace-nowrap" />}
                  </span>
                  {/* Below lg: language, stars and why share the second line. */}
                  <span className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 lg:contents">
                    <span className="flex gap-3 whitespace-nowrap text-[0.82rem] text-faint">
                      {r.language && <span>{r.language}</span>}
                      {r.stars != null && (
                        <span>
                          ★ {compact(r.stars)}
                          <span className="sr-only"> stars</span>
                        </span>
                      )}
                    </span>
                    <span className="font-sans text-[0.92rem] text-muted">{r.why}</span>
                  </span>
                  <span aria-hidden="true" className="hidden text-faint transition-colors group-hover:text-ink lg:block">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 font-sans text-muted">
            Got a repo in mind?
            <Link href={user ? HOME : "/signin"} prefetch={false} className="bracket-link font-mono">
              [ check your repo → ]
            </Link>
          </p>
        </div>
      </>
    </PageTransition>
  );
}
