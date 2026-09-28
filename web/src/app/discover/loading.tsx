import { FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { PageHead } from "@/components/page-head";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <PageHead compact>
          <span className="flex h-[clamp(1.81rem,4.25vw,2.63rem)] items-center">
            <Skeleton className="h-[62%] w-[min(26rem,80%)]" />
          </span>
          <SkeletonText lines={2} lineHeight="1.5rem" bar="0.85rem" last="60%" className="mt-2 hidden max-w-2xl sm:block" />
        </PageHead>
        <div className="wrap py-5 sm:py-6">
          <div aria-hidden="true" className="border border-line-strong bg-panel shadow-soft">
            <div className="p-3 sm:p-4 sm:pb-3"><Skeleton className="h-10 w-full sm:w-[27rem]" /></div>
            <div className="flex gap-2 overflow-hidden border-t border-line p-3 sm:p-4">
              {[12, 8, 10, 10, 4, 6, 6].map((w, i) => (
                <Skeleton key={i} className="h-10 shrink-0" style={{ width: `calc(${w}ch + 28px)` }} />
              ))}
            </div>
          </div>
          <Skeleton className="mb-4 mt-7 h-3 w-56" />
          <FindResultsSkeleton />
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
