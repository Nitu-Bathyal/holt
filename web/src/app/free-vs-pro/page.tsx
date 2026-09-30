// DEV ONLY, temporary: the full free report and the paid report (merge plan)
// for the same repository, one above the other, to compare them. The free
// half renders ReportView directly, as a signed-in visitor sees it: the
// report page itself shows signed-out visitors only a teaser. Not linked from
// anywhere and not indexed. Delete this folder before #144 merges.
import type { Metadata } from "next";
import ExampleAiReportPage from "@/app/example-ai-report/page";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { ReportView } from "@/components/report/report-view";
import { StarterIssues } from "@/components/report/starter-issues";
import { getReport, starterIssues } from "@/lib/api";
import { caller } from "@/lib/session";

export const metadata: Metadata = { title: "Free vs paid report (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const REPO = "pallets/click";

export default async function FreeVsProPage() {
  const [report, issues] = await Promise.all([getReport(REPO), caller().then((c) => starterIssues(REPO, 6, c))]);
  const [owner, repo] = REPO.split("/");
  return (
    <>
      <nav aria-label="Jump to" className="sticky top-[61px] z-30 border-b border-orange bg-bg/95 backdrop-blur">
        <div className="wrap flex flex-wrap items-center gap-x-6 gap-y-1 py-2 text-[0.85rem]">
          <span className="text-orange">dev only · temporary · delete web/src/app/free-vs-pro/ before #144 merges</span>
          <a href="#free" className="text-link">free report ↓</a>
          <a href="#paid" className="text-link">paid report ↓</a>
        </div>
      </nav>

      <Band id="free" title="Free report" note={`/${REPO} · the full report, as a signed-in visitor sees it`} />
      <div className="relative">
        <div aria-hidden="true" className="hero-backdrop bottom-auto h-[560px] [mask-image:linear-gradient(#000_55%,transparent)]" />
        <div className="report-wide relative py-8 sm:py-12">
          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <RepoAvatar repo={REPO} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-[1.05rem] font-semibold tracking-tight sm:text-[1.25rem]">
                <span className="text-muted">{owner}/</span>
                {repo}
              </p>
              <p className="text-[0.82rem] text-faint">github.com/{REPO} ↗</p>
            </div>
          </div>
          {report.ok ? (
            <ReportView report={report.data} signedIn issues={<StarterIssues issues={issues.ok ? issues.data.issues : "unavailable"} repo={REPO} />} />
          ) : (
            <p className="border border-dashed border-line-strong p-4 font-sans text-muted">
              No free report for {REPO} right now ({report.error.message}). Open /{REPO} once to run one.
            </p>
          )}
        </div>
      </div>

      <Band id="paid" title="Paid report" note="/example-ai-report · the merge plan (#144)" />
      <ExampleAiReportPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />
    </>
  );
}

function Band({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div id={id} className="scroll-mt-[105px] border-y-2 border-ink bg-ink text-bg">
      <div className="wrap flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
        <p className="text-[1.4rem] font-semibold tracking-tight sm:text-[1.75rem]">{title}</p>
        <p className="text-[0.85rem] opacity-80">{note}</p>
      </div>
    </div>
  );
}
