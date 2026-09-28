import { FindFiltersSkeleton, FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <PageHead compact>
          <span className="flex h-[clamp(1.81rem,4.25vw,2.63rem)] items-center">
            <Skeleton className="h-[62%] w-[min(34rem,90%)]" />
          </span>
          <SkeletonText lines={2} lineHeight="1.5rem" bar="0.85rem" last="60%" className="mt-2 max-w-2xl" />
        </PageHead>
        <div className="wrap py-5 sm:py-6">
          <FindFiltersSkeleton />
          <Skeleton className="mb-4 mt-9 h-3 w-72" />
          <FindResultsSkeleton count={2} />
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
