// DEV ONLY, temporary: the real free report page and the real paid report
// (merge plan) page for the same repository, one above the other, to see how
// each actually looks. Not linked from anywhere and not indexed. Delete this
// folder before #144 merges.
import type { Metadata } from "next";
import RepoPage from "@/app/[owner]/[repo]/page";
import ExampleAiReportPage from "@/app/example-ai-report/page";

export const metadata: Metadata = { title: "Free vs paid report (dev)", robots: { index: false, follow: false } };

const REPO = { owner: "pallets", repo: "click" };

export default function FreeVsProPage() {
  return (
    <>
      <nav aria-label="Jump to" className="sticky top-[61px] z-30 border-b border-orange bg-bg/95 backdrop-blur">
        <div className="wrap flex flex-wrap items-center gap-x-6 gap-y-1 py-2 text-[0.875rem]">
          <span className="text-orange">dev only · temporary · delete web/src/app/free-vs-pro/ before #144 merges</span>
          <a href="#free" className="text-link">free report ↓</a>
          <a href="#paid" className="text-link">paid report ↓</a>
        </div>
      </nav>

      <Band id="free" title="Free report" note={`/${REPO.owner}/${REPO.repo} · rules only, no account`} />
      <RepoPage params={Promise.resolve(REPO)} searchParams={Promise.resolve({})} />

      <Band id="paid" title="Paid report" note="/example-ai-report · the merge plan (#144)" />
      <ExampleAiReportPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />
    </>
  );
}

function Band({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div id={id} className="scroll-mt-[105px] border-y-2 border-ink bg-ink text-bg">
      <div className="wrap flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
        <p className="text-[1.375rem] font-semibold tracking-tight sm:text-[1.75rem]">{title}</p>
        <p className="text-[0.875rem] opacity-80">{note}</p>
      </div>
    </div>
  );
}
