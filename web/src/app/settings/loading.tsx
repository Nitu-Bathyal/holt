// Inside the settings layout: the heading and the section list stay put, so
// only the section's content is sketched.
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        <Skeleton className="h-7 w-56" />
        <SkeletonText lines={1} lineHeight="1.6rem" bar="0.85rem" className="mt-2" />
        <div className="mt-6 grid gap-px border border-line bg-line shadow-soft sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="bg-panel p-5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-3 h-6 w-28" />
            </div>
          ))}
        </div>
        <SkeletonText lines={4} lineHeight="1.6rem" bar="0.85rem" className="mt-6" />
      </SkeletonRegion>
    </LoadingTransition>
  );
}
