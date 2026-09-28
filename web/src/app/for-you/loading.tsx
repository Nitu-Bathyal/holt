import { LoadingTransition } from "@/components/motion/page-transition";
import { PageHeadSkeleton } from "@/components/page-head-skeleton";
import { RepoGridSkeleton } from "@/components/repo-card/repo-card-skeleton";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <PageHeadSkeleton headline={1} lead={2} />
        <div className="wrap pb-14 pt-2">
          <Skeleton className="mt-6 h-3 w-full max-w-md" />
          <div className="mt-6"><RepoGridSkeleton count={2} /></div>
        </div>
      </SkeletonRegion>
    </LoadingTransition>
  );
}
