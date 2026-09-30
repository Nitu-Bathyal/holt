import Link from "next/link";
import { BUDGETS, reportHref } from "@/lib/budget";

/** "How long can you wait for a first reply?" Links, so it works without JavaScript;
 * the verdict stays the same, only the note about slow replies changes. Sized
 * like the report tabs above it (same height, type and border), right-aligned
 * with the question on one line and the choices under it. */
export function BudgetPicker({ repo, days }: { repo: string; days: number }) {
  return (
    <nav aria-label="How long you can wait for a reply" className="flex flex-col items-end gap-2 font-sans text-[0.85rem]">
      <span className="text-faint">How long can you wait for a first reply?</span>
      <span className="inline-flex border border-line-strong">
        {BUDGETS.map((b) => (
          <Link
            key={b.days}
            href={reportHref(repo, b.days)}
            prefetch={false}
            scroll={false}
            aria-current={b.days === days ? "true" : undefined}
            className={`inline-flex min-h-11 items-center justify-center px-3 transition-colors ${b.days === days ? "bg-ink font-medium text-bg" : "text-muted hover:text-ink"}`}
          >
            {b.label}
          </Link>
        ))}
      </span>
    </nav>
  );
}
