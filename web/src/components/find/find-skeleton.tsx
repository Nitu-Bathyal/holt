// /find while it loads: the filter bar at its real size, then result cards.
import { RepoGridSkeleton } from "../repo-card/repo-card-skeleton";
import { Skeleton } from "../skeleton";

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

/** Result cards while a search loads. */
export function FindResultsSkeleton({ count = 6 }: { count?: number }) {
  return <RepoGridSkeleton count={count} />;
}
