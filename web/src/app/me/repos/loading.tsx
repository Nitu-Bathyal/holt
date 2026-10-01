import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head sentence-head">
            <Skeleton className="h-8 w-80 max-w-full" />
          </div>
          <Skeleton className="h-11 w-60" />
          <ul>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="app-row grid-cols-[auto_minmax(0,1fr)_auto]">
                <Skeleton className="size-4" />
                <span className="flex items-center gap-3">
                  <Skeleton className="size-8" />
                  <span className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-48 max-w-full" />
                    <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
                  </span>
                </span>
                <Skeleton className="h-6 w-32" />
              </li>
            ))}
          </ul>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
