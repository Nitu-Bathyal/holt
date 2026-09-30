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
            <div className="py-3 sm:pb-3 sm:pt-4"><Skeleton className="h-9 w-full sm:w-[27rem]" /></div>
            <div className="flex gap-2 overflow-hidden border-t border-line py-3 sm:py-4">
              {[12, 8, 10, 10, 4, 6, 6].map((w, i) => (
                <Skeleton key={i} className="h-9 shrink-0" style={{ width: `calc(${w}ch + 28px)` }} />
              ))}
            </div>
          </div>
          <Skeleton className="mb-4 mt-7 h-3 w-56" />
          <FindResultsSkeleton />
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
