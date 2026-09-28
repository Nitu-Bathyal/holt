import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="wrap max-w-3xl pb-14">
          <div className="pb-6 pt-8 sm:pt-10">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="mt-3 h-3 w-72 max-w-full" />
          </div>
          <ul className="divide-y divide-line border border-line-strong bg-panel shadow-soft">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-7" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="mt-2 h-2.5 w-32" />
                </span>
                <Skeleton className="h-6 w-28" />
              </li>
            ))}
          </ul>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
