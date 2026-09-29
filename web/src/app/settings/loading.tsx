// Inside the settings layout: the heading and the tabs stay put, so only the
// section is sketched, in its block-and-rows shape.
import { LoadingTransition } from "@/components/motion/page-transition";
import { Skeleton, SkeletonRegion } from "@/components/skeleton";

export default function Loading() {
  return (
    <LoadingTransition>
      <SkeletonRegion>
        {[3, 2].map((rows, b) => (
          <div key={b} className={b ? "mt-10" : undefined}>
            <div className="section-head">
              <Skeleton className="h-4 w-28" />
            </div>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="app-row grid-cols-[minmax(0,1fr)_auto]">
                <span className="min-w-0">
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
                </span>
                <Skeleton className="h-9 w-24" />
              </div>
            ))}
          </div>
        ))}
      </SkeletonRegion>
    </LoadingTransition>
  );
}
