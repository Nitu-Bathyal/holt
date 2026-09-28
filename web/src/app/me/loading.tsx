import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="wrap max-w-6xl pb-14 pt-8 sm:pt-12">
          <Skeleton className="h-9 w-72 max-w-full" />
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Skeleton className="h-44" />
            <Skeleton className="h-16 self-center" />
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="mt-10">
              <Skeleton className="h-4 w-40" />
              <div className="mt-3 flex gap-3 overflow-hidden">
                {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-36 w-[16.5rem] shrink-0 sm:w-72" />)}
              </div>
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
