import { Suspense } from "react";
import { CompareColumns, CompareGridSkeleton } from "@/components/compare/compare-skeleton";
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
          <SkeletonText lines={1} lineHeight="1.5rem" bar="0.85rem" className="mt-2 hidden max-w-lg sm:block" />
          <Skeleton className="mt-5 h-[3.1rem] max-w-2xl" />
        </PageHead>
        <div className="wrap py-6 sm:py-8">
          <Suspense fallback={<CompareColumns n={2} />}>
            <CompareGridSkeleton />
          </Suspense>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
