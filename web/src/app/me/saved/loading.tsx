import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head">
            <Skeleton className="h-10 w-72 max-w-full" />
            <Skeleton className="mt-4 h-3 w-56 max-w-full" />
          </div>
          <ul className="divide-y divide-line border border-line-strong bg-panel shadow-soft">
            {[0, 1, 2].map((i) => (
              <li key={i} className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8">
                <span>
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-2 h-3 w-full max-w-sm" />
                </span>
                <span>
                  <Skeleton className="h-7 w-36" />
                  <Skeleton className="mt-3 h-3 w-full max-w-xs" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
