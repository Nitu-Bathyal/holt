// /find while it loads: the filter bar at its real size, then result cards.
import { Skeleton, SkeletonCard, SkeletonText } from "../skeleton";

export function FindFiltersSkeleton() {
  return (
    <div aria-hidden="true" className="border border-line-strong bg-panel shadow-soft">
      <div className="flex gap-2 overflow-hidden p-3 sm:flex-wrap sm:p-4 sm:pb-3">
        {[12, 6, 10, 10, 2, 4, 4, 3, 4, 3, 3].map((w, i) => (
          <Skeleton key={i} className="h-10 shrink-0" style={{ width: `calc(${w}ch + 28px)` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-3 py-3 sm:px-4">
        <Skeleton className="h-10 w-full sm:w-80" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="ml-auto h-4 w-28" />
      </div>
    </div>
  );
}

/** One result: repo line, verdict, stats, and two starter issues. */
export function FindResultSkeleton() {
  return (
    <li aria-hidden="true" className="border border-line-strong bg-panel shadow-soft">
      <div className="flex flex-wrap items-start gap-4 border-b border-line p-5 sm:p-6">
        <span className="size-10 rounded-md border border-line-strong bg-panel-2" />
        <div className="min-w-0 flex-1">
          <span className="flex h-[1.9rem] items-center">
            <Skeleton className="h-4 w-48" />
          </span>
          <SkeletonText lines={1} lineHeight="1.56rem" bar="0.75rem" className="mt-1 w-4/5" />
          <span className="mt-2 flex h-[1.24rem] items-center gap-4">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-2.5 w-32" />
          </span>
        </div>
        <Skeleton className="hidden h-7 w-36 sm:block" />
      </div>
      <div className="p-5 sm:p-6">
        <Skeleton className="mb-3 h-3 w-28" />
        <ul className="grid gap-3 md:grid-cols-2">
          <SkeletonCard compact />
          <SkeletonCard compact className="hidden md:block" />
        </ul>
        <Skeleton className="mt-4 h-3 w-52" />
      </div>
    </li>
  );
}

export function FindResultsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ol className="space-y-6">
      {Array.from({ length: count }, (_, i) => (
        <FindResultSkeleton key={i} />
      ))}
    </ol>
  );
}
