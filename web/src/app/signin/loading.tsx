import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion className="relative overflow-hidden">
        <div aria-hidden="true" className="hero-backdrop" />
        <div className="wrap relative grid min-h-[78dvh] items-center gap-14 py-10 sm:py-16 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-20">
          <div className="mx-auto w-full max-w-md border border-line-strong bg-panel p-6 shadow-card sm:p-9 lg:mx-0">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-5 h-11 w-4/5" />
            <SkeletonText lines={2} lineHeight="1.7rem" bar="0.85rem" className="mt-3" />
            <Skeleton className="mt-7 h-13" />
            <Skeleton className="mt-3 h-13" />
            <SkeletonText lines={3} lineHeight="1.5rem" bar="0.75rem" className="mt-7" />
          </div>
          <div className="hidden border border-line-strong bg-panel p-7 shadow-card lg:block">
            <Skeleton className="h-7 w-36" />
            <SkeletonText lines={2} lineHeight="1.8rem" bar="0.9rem" className="mt-5" />
            <Skeleton className="mt-6 h-20" />
          </div>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
