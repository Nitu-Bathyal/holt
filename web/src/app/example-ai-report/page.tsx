import type { Metadata } from "next";
import Link from "next/link";
import { MergePlanView } from "@/components/merge-plan/merge-plan-view";
import { PageTransition } from "@/components/motion/page-transition";
import { RepoAvatar } from "@/components/repo-card/repo-avatar";
import { EXAMPLE_PATH } from "@/lib/example-report";
import type { MergePlan } from "@/lib/merge-plan";
import data from "@/lib/example-merge-plan.json";

// A recorded merge plan for pallets/click: the counts, quotes and links are
// real (holt-pro's playbook replayed from its test fixture, the free report
// and starter issue from the live API, the AI findings from Holt's recorded
// model run); the call and step wording stand in for the model until holt-pro
// writes merge plans.
const plan = data as MergePlan;
const recorded = new Date(plan.recorded_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const [owner, repo] = plan.repo.split("/");

export const metadata: Metadata = {
  title: "Example AI report",
  description: `A full AI report on ${plan.repo}, free to read: what the AI found, a step-by-step plan for your first pull request, what gets merged, what gets closed and who reviews. Recorded ${recorded}.`,
  alternates: { canonical: EXAMPLE_PATH },
};

export default async function ExampleAiReportPage({ searchParams }: PageProps<"/example-ai-report">) {
  const locked = (await searchParams).view === "locked";
  return (
    <PageTransition>
      <div className="relative">
        <div aria-hidden="true" className="hero-backdrop bottom-auto h-[560px] [mask-image:linear-gradient(#000_55%,transparent)]" />
        <div className="wrap relative py-8 sm:py-12">
          <aside className="mb-6 border border-blue/50 bg-blue/[0.06] p-4 sm:p-5" data-example-banner>
            <p className="text-[0.8rem] uppercase tracking-[0.08em] text-blue">Example AI report (recorded {recorded})</p>
            <p className="mt-2 max-w-3xl font-sans text-[0.95rem] text-ink">A recorded example, not a live report. Free to read.</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
              <Link href="/" className="bracket-link">[ get one for your repo → ]</Link>
              <Link href={locked ? EXAMPLE_PATH : `${EXAMPLE_PATH}?view=locked`} className="text-link font-sans text-[0.89rem]">
                {locked ? "see the whole plan" : "what you see before unlocking"}
              </Link>
            </div>
          </aside>

          <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
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
            <nav aria-label="Report type" className="grid w-full grid-cols-2 border border-line-strong text-center text-[0.85rem] sm:w-auto">
              <Link href={`/${plan.repo}`} className="inline-flex min-h-11 items-center justify-center px-3 text-muted transition-colors hover:text-ink">
                free report
              </Link>
              <span aria-current="page" className="inline-flex min-h-11 items-center justify-center bg-blue px-3 text-on-accent">
                AI report ✦
              </span>
            </nav>
          </div>

          <MergePlanView plan={plan} locked={locked} />
        </div>
      </div>
    </PageTransition>
  );
}
