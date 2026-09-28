import type { Metadata } from "next";
import Link from "next/link";
import { MergePlanView } from "@/components/merge-plan/merge-plan-view";
import { PageTransition } from "@/components/motion/page-transition";
import { EXAMPLE_PATH } from "@/lib/example-report";
import type { MergePlan } from "@/lib/merge-plan";
import data from "@/lib/example-merge-plan.json";

// A recorded merge plan for pallets/click: the counts, quotes and links are
// real (holt-pro's playbook replayed from its test fixture, the free report
// and starter issue from the live API); the call and step wording stand in
// for the model until holt-pro writes merge plans.
const plan = data as MergePlan;
const recorded = new Date(plan.recorded_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const metadata: Metadata = {
  title: "Example AI report",
  description: `A full AI report on ${plan.repo}, free to read: what to do for your first pull request, what gets merged, what gets closed and who reviews. Recorded ${recorded}.`,
  alternates: { canonical: EXAMPLE_PATH },
};

export default async function ExampleAiReportPage({ searchParams }: PageProps<"/example-ai-report">) {
  const locked = (await searchParams).view === "locked";
  return (
    <PageTransition>
      <div className="wrap py-8 sm:py-12">
        <aside className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-dashed border-line-strong px-4 py-3" data-example-banner>
          <p className="font-sans text-[0.92rem] text-muted">
            <span className="font-mono text-[0.82rem] uppercase tracking-[0.08em] text-ink">Example</span> · recorded {recorded}, not live. Free
            to read, no account needed.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.88rem]">
            <Link href={locked ? EXAMPLE_PATH : `${EXAMPLE_PATH}?view=locked`} className="text-link">
              {locked ? "see the whole plan" : "what free users see"}
            </Link>
            <Link href="/" className="text-link">
              get one for your repo
            </Link>
          </div>
        </aside>
        <MergePlanView plan={plan} locked={locked} />
      </div>
    </PageTransition>
  );
}
