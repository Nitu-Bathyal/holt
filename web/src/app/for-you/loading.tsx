import { LoadingTransition } from "@/components/motion/page-transition";
import { PageHeadSkeleton } from "@/components/page-head-skeleton";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <PageHeadSkeleton narrow headline={1} lead={2} />
        <div className="wrap max-w-3xl pb-14 pt-2">
          <Skeleton className="mt-6 h-3 w-full max-w-md" />
          <ol className="mt-6 space-y-4">
            {[0, 1].map((i) => (
              <li key={i} className="border border-line-strong bg-panel p-5 shadow-soft sm:p-6">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-3 h-3 w-full max-w-md" />
                <Skeleton className="mt-6 h-3 w-64" />
                <Skeleton className="mt-2 h-3 w-56" />
                <Skeleton className="mt-2 h-3 w-60" />
              </li>
            ))}
          </ol>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
