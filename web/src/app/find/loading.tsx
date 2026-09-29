import { FindFrameSkeleton } from "@/components/find/find-frame";
import { FindFiltersSkeleton, FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <FindFrameSkeleton>
          <FindFiltersSkeleton />
          <Skeleton className="mb-4 mt-9 h-3 w-72" />
          <FindResultsSkeleton count={3} />
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
