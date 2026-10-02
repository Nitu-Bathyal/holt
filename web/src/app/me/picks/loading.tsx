import { LoadingTransition } from "@/components/motion/page-transition";
import { RepoCardSkeleton } from "@/components/repo-card/repo-card-skeleton";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <div className="app-page">
          <div className="app-head sentence-head">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="mt-4 h-3 w-80 max-w-full" />
          </div>
          <ol className="card-grid" style={{ "--cols": 3 } as React.CSSProperties}>
            {[0, 1, 2, 3, 4, 5].map((i) => <RepoCardSkeleton key={i} />)}
          </ol>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
