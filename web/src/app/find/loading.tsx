import { FindFrameSkeleton } from "@/components/find/find-frame";
import { FindFiltersSkeleton, FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <FindFrameSkeleton>
          <FindFiltersSkeleton />
          <div className="mt-5">
            <FindResultsSkeleton count={3} />
          </div>
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
