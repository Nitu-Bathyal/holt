// A compact repo card while a list loads, at the card's real size.
import { Skeleton } from "../skeleton";

export function RepoCardSkeleton() {
  return (
    <li aria-hidden="true" className="flex flex-col border border-line-strong bg-panel p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <span className="size-8 shrink-0 rounded-md border border-line-strong bg-panel-2" />
        <div className="min-w-0 flex-1">
          <span className="flex h-5 items-center"><Skeleton className="h-3.5 w-40" /></span>
          <span className="mt-0.5 flex h-5 items-center"><Skeleton className="h-2.5 w-4/5" /></span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="mt-3 h-1.5 w-full" />
      <div className="mt-2.5 flex gap-1.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="mt-3 border-t border-dashed border-line pt-2.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="mt-2 h-3 w-11/12" />
      </div>
      <Skeleton className="mt-4 h-3 w-28" />
    </li>
  );
}

export function RepoGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <RepoCardSkeleton key={i} />
      ))}
    </ol>
  );
}
