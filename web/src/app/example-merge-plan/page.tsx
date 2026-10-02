import type { Metadata } from "next";
import Link from "next/link";
import { MergePlanView } from "@/components/merge-plan/merge-plan-view";
import { PageTransition } from "@/components/motion/page-transition";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { ReportBackLink, ReportModeLink } from "@/components/report/report-tabs";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { EXAMPLE_PLAN as plan, planRecordedOn } from "@/lib/merge-plan";

// A recorded merge plan for processing/p5.js. The counts, quotes and links are
// real: holt-pro's playbook facts from the repo's recorded pull requests, the
// free report from the public API, and maintainers' comments on those pull
// requests. The call, the step wording and the reading of the threads stand in
// for the AI until holt-pro writes merge plans.
const recorded = planRecordedOn(plan);
const [owner, repo] = plan.repo.split("/");

export const metadata: Metadata = {
  title: "Example merge plan",
  description: `A full merge plan for ${plan.repo}, free to read: a step-by-step plan for your first pull request, what gets merged, what gets closed and who reviews. Recorded ${recorded}.`,
  alternates: { canonical: EXAMPLE_PATH },
};

export default async function ExampleMergePlanPage({ searchParams }: PageProps<"/example-merge-plan">) {
  const locked = (await searchParams).view === "locked";
  return (
    <PageTransition>
      <div className="relative">
        {/* The same page as a report: no backdrop, the example said in one quiet note above it. */}
        <div className="report-wide relative py-8 sm:py-12">
          <aside className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-line-strong bg-panel-2 px-4 py-3 font-sans text-[0.9rem] text-muted" data-example-banner>
            <span className="border border-blue px-2 py-0.5 font-mono text-[0.85rem] text-blue">Example merge plan</span>
            <span className="min-w-0 flex-1">
              Recorded {recorded}. Real counts, quotes and links; the plan&apos;s wording stands in for the AI&apos;s.
            </span>
            <span className="flex flex-wrap gap-x-4 gap-y-2">
              <Link href={locked ? EXAMPLE_PATH : `${EXAMPLE_PATH}?view=locked`} className="text-link tap">
                {locked ? "see the whole plan" : "what you see before unlocking"}
              </Link>
              <Link href="/" className="text-link tap">get one for your repo</Link>
            </span>
          </aside>

          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <ReportBackLink href={`/${plan.repo}`} />
            <RepoAvatar repo={plan.repo} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-[1.05rem] font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[1.25rem]">
                <span className="text-muted">{owner}/</span>
                {repo}
              </p>
              <a href={`https://github.com/${plan.repo}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center truncate text-[0.82rem] text-faint hover:text-blue sm:block sm:min-h-0">
                github.com/{plan.repo} ↗
              </a>
            </div>
            <ReportModeLink mode="ai" rulesHref={`/${plan.repo}`} aiHref={EXAMPLE_PATH} />
          </div>

          <MergePlanView plan={plan} locked={locked} />
        </div>
      </div>
    </PageTransition>
  );
}
