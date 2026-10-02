// The way between a repo's report and its merge plan: one small
// button in the report header, beside Save, with a PRO sticker. While merge
// plans can't be made it is switched off and says "coming soon". On the report
// it offers the merge plan; on the plan it opens the report, and a back arrow
// at the start of the header (ReportBackLink) goes there too. The report page
// and the example merge plan both draw them, so this is the one place they're worded.
import Link from "next/link";
import type { PlanCta } from "@/lib/merge-plan-offer";
import { ComingSoon } from "../coming-soon";
import { LinkHint } from "../motion/link-hint";

const BASE = "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 border px-3 text-[0.82rem] font-medium transition-colors sm:min-h-9";

/** `mode` is the page being shown; the button goes to the other one (`plan`: lib/merge-plan-offer.ts). No prefetch: for most visitors the merge plan is sign-in. */
export function ReportModeLink({ mode, rulesHref, plan, hint = false }: { mode: "rules" | "ai"; rulesHref: string; plan: PlanCta; hint?: boolean }) {
  if (mode === "rules" && plan.kind === "soon") {
    // Not a link and not focusable: the pricing page's "not on sale" look, a dashed edge and the amber chip.
    return (
      <span aria-disabled="true" className={`${BASE} cursor-default border-dashed border-line-strong text-muted`} data-report-mode="soon">
        Merge plan
        <ComingSoon small />
      </span>
    );
  }
  return mode === "rules" && plan.kind === "start" ? (
    <Link href={plan.href} prefetch={false} className={`${BASE} border-blue/60 text-blue hover:bg-blue hover:text-on-accent`} data-report-mode="ai">
      Merge plan
      {/* A filled sticker in the site's violet: it stands apart from the blue button, and stays the same when the button fills on hover. */}
      <span className="rounded-[3px] bg-hf px-1.5 py-[3px] font-sans text-[0.6rem] font-bold uppercase leading-none tracking-[0.08em] text-bg">Pro</span>
      {hint && <LinkHint />}
    </Link>
  ) : (
    <Link href={rulesHref} prefetch={false} className={`${BASE} border-blue/60 text-blue hover:bg-blue hover:text-on-accent`} data-report-mode="rules">
      Report
      {hint && <LinkHint />}
    </Link>
  );
}

/** On the merge plan: a back arrow before the repo's name, to its report. */
export function ReportBackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label="Back to the report"
      title="Back to the report"
      className="grid size-10 shrink-0 place-items-center self-start border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
      data-report-back
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </svg>
    </Link>
  );
}
