import { FindFrameSkeleton } from "@/components/find/find-frame";
import { FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <FindFrameSkeleton>
          <Skeleton className="mb-5 h-7 w-64 rounded-full" />
          <div className="flex flex-wrap gap-2">
            {[14, 6, 7, 2, 4, 4, 7, 4, 3].map((w, i) => (
              <Skeleton key={i} className="h-11" style={{ width: `calc(${w}ch + 34px)` }} />
            ))}
          </div>
          <div className="mt-6">
            <FindResultsSkeleton />
          </div>
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
