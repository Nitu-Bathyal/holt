import Link from "next/link";
import { EXAMPLE_PATH } from "@/lib/example-report";
import type { PlanCta } from "@/lib/merge-plan-offer";
import { ComingSoon } from "../coming-soon";

/** What the merge plan holds, in the words the plan uses for its sections. */
const INSIDE = ["Your first pull request, step by step", "What gets merged here", "Why outside ones get closed"];

/**
 * The free report's way into the merge plan. Dressed like the
 * sidebar's other cards: a quiet heading, plain text, one button. While merge
 * plans can't be made (`plan.kind` "soon") the button is gone and a chip says so.
 */
export function UpgradeCard({ plan }: { plan: PlanCta }) {
  return (
    <section className="rounded-lg border border-line-strong bg-panel p-4 sm:p-5" data-merge-plan-card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[0.85rem] font-semibold text-muted">Merge plan</h2>
        {plan.kind === "soon" && <ComingSoon small />}
      </div>
      <p className="mt-3 text-[1rem] font-semibold leading-snug tracking-tight">What to do here to get merged</p>
      <ul className="mt-2.5 divide-y divide-line font-sans text-[0.88rem] text-muted">
        {INSIDE.map((t) => (
          <li key={t} className="py-1.5 first:pt-0">{t}</li>
        ))}
      </ul>
      <p className="mt-2 font-sans text-[0.8rem] text-faint">In the maintainers&apos; own words.</p>
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {plan.kind === "start" && (
          <Link href={plan.href} prefetch={false} className="btn-primary">
            get my merge plan
          </Link>
        )}
        <Link href={EXAMPLE_PATH} className="text-link text-[0.85rem]">see an example</Link>
      </div>
    </section>
  );
}
