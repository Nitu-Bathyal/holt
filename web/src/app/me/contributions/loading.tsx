import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

// The first visit reads GitHub, which can take a few seconds.
export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head">
            <Skeleton className="h-10 w-72 max-w-full" />
            <Skeleton className="mt-4 h-3 w-80 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-px border border-line bg-line shadow-soft sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-panel p-4 sm:p-5">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="mt-3 h-6 w-10" />
              </div>
            ))}
          </div>
          <ul className="mt-12 border border-line-strong bg-panel shadow-soft">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-3 h-4 w-full max-w-md" />
                <Skeleton className="mt-3 h-6 w-32" />
              </li>
            ))}
          </ul>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
