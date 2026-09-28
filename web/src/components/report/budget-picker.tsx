import Link from "next/link";
import { BUDGETS, reportHref } from "@/lib/budget";

/** "How long can you wait for a reply?" Links, so it works without JavaScript;
 * the verdict stays the same, only the note about slow replies changes. */
export function BudgetPicker({ repo, days }: { repo: string; days: number }) {
  return (
    <nav aria-label="How long you can wait for a reply" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.78rem]">
      <span className="text-muted">How long can you wait for a first reply?</span>
      <span className="inline-flex border border-line-strong">
        {BUDGETS.map((b) => (
          <Link
            key={b.days}
            href={reportHref(repo, b.days)}
            prefetch={false}
            scroll={false}
            aria-current={b.days === days ? "true" : undefined}
            className={`inline-flex min-h-11 items-center px-3 transition-colors sm:min-h-9 ${b.days === days ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
          >
            {b.label}
          </Link>
        ))}
      </span>
    </nav>
  );
}
