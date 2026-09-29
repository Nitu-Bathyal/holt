import { FindFrameSkeleton } from "@/components/find/find-frame";
import { FindResultsSkeleton } from "@/components/find/find-skeleton";
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <FindFrameSkeleton>
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
        </FindFrameSkeleton>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
