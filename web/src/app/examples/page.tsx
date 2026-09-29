import type { Metadata } from "next";
import Link from "next/link";
import { CatFace } from "@/components/cat-face";
import { PageTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { TONE, TONE_MOOD } from "@/components/report/tone";
import { VerdictPill } from "@/components/report/verdict-pill";
import { getReport } from "@/lib/api";
import { EXAMPLE_PATH, EXAMPLE_REPORT, exampleRecordedOn } from "@/lib/example-report";
import { EXAMPLES, EXAMPLES_PATH } from "@/lib/examples";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Example reports",
  description: "Read a few full Holt reports without an account: one repo that's worth your time, one that isn't, one without enough evidence, and an AI report.",
  alternates: { canonical: EXAMPLES_PATH },
};

// The curated examples (lib/examples.ts), each with today's verdict from the
// cache. Reading the cache starts no checks.
export default async function ExamplesPage() {
  const [reports, user] = await Promise.all([Promise.all(EXAMPLES.map((e) => getReport(e.repo))), currentUser()]);
  const ai = EXAMPLE_REPORT;

  return (
    <PageTransition>
      <>
        <PageHead narrow>
          <p className="rail mb-4 flex gap-2">
            <strong className="m-0">examples</strong>
            <span>no account needed</span>
          </p>
          <h1 className="display max-w-3xl text-[clamp(2rem,6vw,3.2rem)]">
            See what a report <span className="text-blue">tells you.</span>
          </h1>
          <p className="prose-sans mt-5 max-w-2xl text-[1.05rem]">
            Three real repos, one for each answer Holt can give, and an AI report that explains the evidence in plain
            English.
          </p>
        </PageHead>

        <div className="wrap max-w-3xl py-8 sm:py-12">
          <ul className="space-y-4">
            {EXAMPLES.map((e, i) => {
              const r = reports[i];
              const report = r.ok ? r.data : null;
              const t = TONE[report?.tone ?? "neutral"];
              return (
                <li key={e.repo}>
                  <Link href={`/${e.repo}`} className="group relative block border border-line-strong bg-panel p-5 pl-6 shadow-card transition-colors hover:border-blue sm:p-6 sm:pl-8">
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bg}`} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere]">{e.repo}</p>
                      {report && <VerdictPill headline={report.headline} tone={report.tone} />}
                    </div>
                    <p className="mt-2 font-sans text-[0.95rem] text-muted">{report?.verdict_line ?? e.why}</p>
                    <p className="mt-3 text-[0.87rem] text-muted group-hover:text-ink">
                      read the report <span aria-hidden="true">→</span>
                    </p>
                  </Link>
                </li>
              );
            })}
            <li>
              <Link href={EXAMPLE_PATH} className="group relative block border border-blue/50 bg-blue/[0.06] p-5 pl-6 transition-colors hover:border-blue sm:p-6 sm:pl-8">
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-blue" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere]">{ai.repo}</p>
                  <span className="flex items-center gap-2 text-[0.8rem] uppercase tracking-[0.08em] text-blue">
                    <CatFace mood={TONE_MOOD[ai.tone]} className="normal-case tracking-normal" /> AI report ✦
                  </span>
                </div>
                <p className="mt-2 font-sans text-[0.95rem] text-muted">
                  The same kind of report, with the evidence explained in plain English and every sentence citing a
                  GitHub thread. Recorded {exampleRecordedOn(ai)}.
                </p>
                <p className="mt-3 text-[0.87rem] text-muted group-hover:text-ink">
                  read the AI report <span aria-hidden="true">→</span>
                </p>
              </Link>
            </li>
          </ul>

          <div className="mt-10 border-t border-line pt-8">
            <p className="font-sans text-[1rem] text-ink">Got a repo of your own in mind?</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              {user ? (
                <Link href="/" className="bracket-link">[ check a repo → ]</Link>
              ) : (
                <Link href="/signin" prefetch={false} className="bracket-link">[ sign in to check it, free → ]</Link>
              )}
            </div>
          </div>
        </div>
      </>
    </PageTransition>
  );
}
