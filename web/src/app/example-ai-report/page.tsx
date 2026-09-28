import type { Metadata } from "next";
import Link from "next/link";
import { PageTransition } from "@/components/motion/page-transition";
import { ReportView } from "@/components/report/report-view";
import { EXAMPLE_PATH, EXAMPLE_REPORT, exampleRecordedOn } from "@/lib/example-report";
import { WELCOME_AI_CREDITS } from "@/lib/site";

const report = EXAMPLE_REPORT;
const recorded = exampleRecordedOn(report);
const [owner, repo] = report.repo.split("/");

export const metadata: Metadata = {
  title: "Example AI report",
  description: `A full AI report on ${report.repo}, free to read: the written explanation, the quoted pull-request threads and the evidence. Recorded ${recorded}.`,
  alternates: { canonical: EXAMPLE_PATH },
};

export default function ExampleAiReportPage() {
  return (
    <PageTransition>
      <div className="relative">
        <div aria-hidden="true" className="hero-backdrop bottom-auto h-[560px] [mask-image:linear-gradient(#000_55%,transparent)]" />
        <div className="wrap relative py-8 sm:py-12">
          <aside className="mb-6 border border-blue/50 bg-blue/[0.06] p-4 sm:p-5" data-example-banner>
            <p className="text-[0.72rem] uppercase tracking-[0.08em] text-blue">Example AI report (recorded {recorded})</p>
            <p className="mt-2 max-w-3xl font-sans text-[0.95rem] text-ink">
              This is a recorded example, not a live report. It shows what an AI report adds for {report.repo}, using
              GitHub activity up to {recorded}. Anyone can read it: no account, no free report spent.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
              <Link href="/" className="bracket-link">[ get one for your repo → ]</Link>
              <Link href={`/${report.repo}`} className="bracket-link">[ see today&apos;s free report for {report.repo} → ]</Link>
              <span className="font-sans text-[0.8rem] text-faint">sign in for {WELCOME_AI_CREDITS} free AI reports</span>
            </div>
          </aside>

          <div className="mb-6 min-w-0">
            <p className="text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.25rem]">
              <span className="text-muted">{owner}/</span>
              {repo}
            </p>
            <a href={`https://github.com/${report.repo}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center truncate text-[0.75rem] text-faint hover:text-blue sm:block sm:min-h-0">
              github.com/{report.repo} ↗
            </a>
          </div>

          <ReportView
            report={report}
            signedIn={false}
            example
            issues={
              <p className="border border-dashed border-line-strong p-4 font-sans text-[0.95rem] text-muted">
                Starter issues change every day, so they aren&apos;t part of this recorded example.{" "}
                <Link href={`/${report.repo}`} className="text-link">See today&apos;s starter issues for {report.repo}</Link>.
              </p>
            }
          />
        </div>
      </div>
    </PageTransition>
  );
}
