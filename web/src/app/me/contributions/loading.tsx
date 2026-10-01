import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

// The first visit reads GitHub, which can take a few seconds. The page's
// shape: the sentence, the numbers and refresh, then a group of PR rows,
// each with its repo, title and wait bar.
export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head sentence-head">
            <Skeleton className="h-8 w-[26rem] max-w-full" />
            <Skeleton className="mt-3 h-8 w-60 max-w-full" />
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <Skeleton className="h-3 w-80 max-w-full" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="mt-6">
            <div className="section-head">
              <Skeleton className="h-4 w-24" />
            </div>
            <ul>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="app-row grid-cols-[minmax(0,1fr)_auto]">
                  <span className="min-w-0 pl-2">
                    <Skeleton className="h-3.5 w-44 max-w-full" />
                    <Skeleton className="mt-2 h-4 w-96 max-w-full" />
                    <Skeleton className="mt-3 h-1.5 w-64 max-w-full" />
                  </span>
                  <Skeleton className="h-3 w-20" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
