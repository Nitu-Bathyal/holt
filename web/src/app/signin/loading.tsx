import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion className="relative overflow-hidden">
        <div aria-hidden="true" className="hero-backdrop" />
        <div className="wrap relative flex min-h-[78dvh] items-center justify-center py-10 sm:py-16">
          <div className="w-full max-w-md border border-line-strong bg-panel p-6 shadow-card sm:p-9 lg:max-w-[27rem]">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="mt-5 h-11 w-4/5" />
            <SkeletonText lines={2} lineHeight="1.7rem" bar="0.85rem" className="mt-3" />
            <Skeleton className="mt-7 h-13" />
            <Skeleton className="mt-3 h-13" />
            <SkeletonText lines={3} lineHeight="1.5rem" bar="0.75rem" className="mt-7" />
          </div>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
