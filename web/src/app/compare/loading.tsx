import { Suspense } from "react";
import { CompareColumns, CompareGridSkeleton } from "@/components/compare/compare-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head">
            <span className="flex h-[clamp(2.09rem,3.96vw,3.3rem)] items-center">
              <Skeleton className="h-[62%] w-[min(34rem,90%)]" />
            </span>
            <Skeleton className="mt-6 h-[3.1rem] max-w-2xl" />
          </div>
          <Skeleton className="mb-4 h-3.5 w-48" />
          <Suspense fallback={<CompareColumns n={2} />}>
            <CompareGridSkeleton />
          </Suspense>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
