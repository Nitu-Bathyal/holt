import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="wrap max-w-6xl pb-14">
          <div className="pb-6 pt-8 sm:pt-10">
            <Skeleton className="h-8 w-72 max-w-full" />
            <Skeleton className="mt-3 h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-16" />
          {[0, 1].map((i) => (
            <div key={i} className="mt-12">
              <Skeleton className="h-4 w-40" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((j) => <Skeleton key={j} className={`h-44 ${j > 0 ? "max-sm:hidden" : ""} ${j > 1 ? "max-lg:hidden" : ""}`} />)}
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
