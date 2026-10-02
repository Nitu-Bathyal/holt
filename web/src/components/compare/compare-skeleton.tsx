"use client";
// /compare while it loads: the table's shape, one column per repo in the URL.
import { ABOUT_ROWS, ROWS } from "@/lib/compare";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "../skeleton";

/** Reads ?repos= so the skeleton has as many columns as the page will: none for the empty page, which has no table. */
export function CompareGridSkeleton() {
  const sp = useSearchParams();
  const n = Math.min(4, (sp.get("repos") ?? "").split(",").filter(Boolean).length + (sp.get("add") ? 1 : 0));
  return n ? <CompareColumns n={n} /> : null;
}

export function CompareColumns({ n }: { n: number }) {
  const cols = Array.from({ length: n }, (_, i) => i);
  return (
    <div aria-hidden="true" className="cmp-scroll" data-many={n > 2 || undefined}>
      <div className="cmp" style={{ "--n": n } as React.CSSProperties}>
        <div className="cmp-row cmp-head">
          <div className="cmp-label cmp-corner" />
          {cols.map((i) => (
            <div key={i} className="cmp-cell cmp-col-head">
              <div className="flex items-start gap-2.5">
                <span className="hidden size-7 shrink-0 rounded border border-line-strong bg-panel-2 sm:block" />
                <span className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="h-3.5 w-24" />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="cmp-row">
          <div className="cmp-label sr-only" />
          {cols.map((i) => (
            <div key={i} className="cmp-cell">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-3 h-1.5" />
            </div>
          ))}
        </div>
        {[...ROWS, ...ABOUT_ROWS].map((r) => (
          <div key={r.id} className="cmp-row" data-about={r.id === ABOUT_ROWS[0].id ? "first" : undefined}>
            <div className="cmp-label"><span>{r.label}</span></div>
            {cols.map((i) => (
              <div key={i} className="cmp-cell">
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
