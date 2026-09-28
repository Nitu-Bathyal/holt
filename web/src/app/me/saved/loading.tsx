import { LoadingTransition } from "@/components/motion/page-transition";
import { PageHeadSkeleton } from "@/components/page-head-skeleton";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <PageHeadSkeleton headline={1} lead={1} />
        <div className="wrap py-10 sm:py-12">
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
