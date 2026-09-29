import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

// The home's head (the next move, its action, the loop), then a section of rows.
export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head">
            <Skeleton className="h-10 w-[28rem] max-w-full" />
            <Skeleton className="mt-3 h-10 w-72 max-w-full" />
            <Skeleton className="mt-7 h-12 w-56" />
            <Skeleton className="mt-8 h-3 w-full max-w-[44rem]" />
          </div>
          <div className="mt-14">
            <Skeleton className="h-4 w-40" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="app-row grid-cols-[minmax(0,1fr)]">
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
