import { FindFrameSkeleton } from "@/components/find/find-frame";
import { FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <FindFrameSkeleton>
          <div aria-hidden="true" className="find-tray">
            <div className="find-bar flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 @3xl:flex-nowrap">
              <Skeleton className="h-10 w-full sm:h-8 @3xl:w-[22rem] @3xl:shrink-0" />
              <div className="flex w-full min-w-0 gap-1.5 overflow-hidden @3xl:w-auto @3xl:flex-1">
                {[12, 8, 10, 10, 4, 6, 6].map((w, i) => (
                  <Skeleton key={i} className="h-10 shrink-0 sm:h-8" style={{ width: `calc(${w}ch + 24px)` }} />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <FindResultsSkeleton />
          </div>
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
