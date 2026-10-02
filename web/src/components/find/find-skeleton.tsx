// /find while it loads: the filter bar at its real size, then result cards.
import { RepoGridSkeleton } from "../repo-card/repo-card-skeleton";
import { Skeleton } from "../skeleton";

export function FindFiltersSkeleton() {
  return (
    <div aria-hidden="true" className="find-tray">
      <div className="find-bar flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 @5xl:flex-nowrap">
        <div className="flex w-full min-w-0 gap-1.5 overflow-hidden @5xl:w-auto @5xl:flex-1">
          {[12, 6, 10, 10, 2, 4, 4, 3, 4, 3, 3].map((w, i) => (
            <Skeleton key={i} className="h-10 shrink-0 sm:h-8" style={{ width: `calc(${w}ch + 24px)` }} />
          ))}
        </div>
        <div className="flex w-full items-center gap-x-4 @5xl:w-auto @5xl:shrink-0">
          <Skeleton className="h-10 flex-1 sm:h-8 sm:w-72 sm:flex-none" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      </div>
    </div>
  );
}

/** Result cards while a search loads. */
export function FindResultsSkeleton({ count = 6 }: { count?: number }) {
  return <RepoGridSkeleton count={count} verdict={false} />;
}
