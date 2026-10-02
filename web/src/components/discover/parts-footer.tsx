"use client";

// What sits under a list that loads in parts (use-parts.ts): the sentinel the
// next part is asked from, the "load more" button for when nothing asks by
// itself (no IntersectionObserver, a keyboard), a failed part's error with a
// way to ask again, and the end.
import type { Parts } from "@/lib/parts";
import { RepoCardSkeleton } from "../repo-card/repo-card-skeleton";
import type { PartsList } from "./use-parts";

/** Placeholder cards for the part on its way, to go in the list's own grid (RepoGrid's `tail`). */
export function partsTail(state: Parts<unknown>, opts: { count?: number; verdict?: boolean } = {}): React.ReactNode {
  if (state.status !== "loading") return null;
  return Array.from({ length: opts.count ?? 4 }, (_, i) => <RepoCardSkeleton key={`loading-${i}`} verdict={opts.verdict} />);
}

export function PartsFooter<T>({ list, shown }: {
  list: PartsList<T>;
  /** How many items are on the page, when not all that were loaded are shown. */
  shown?: number;
}) {
  const { state, more, sentinel } = list;
  const loading = state.status === "loading";
  const count = shown ?? state.items.length;
  return (
    <div className="mt-6 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 text-[0.85rem]">
      <div ref={sentinel} aria-hidden="true" className="h-px w-full" />
      <p role="status" className="sr-only">{loading ? "Loading more repos…" : ""}</p>
      {state.status === "error" && state.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-orange">{state.error.message}</p>
          <button type="button" onClick={more} className="btn-ghost">try again</button>
        </div>
      ) : state.next !== null ? (
        // Kept in place while a part loads, so a keyboard's focus stays on it.
        <button type="button" onClick={more} aria-disabled={loading} className={`btn-ghost ${loading ? "cursor-default text-faint" : ""}`}>
          {loading ? "loading…" : "load more"}
        </button>
      ) : count > 0 ? (
        <p className="text-faint">That&apos;s all {count.toLocaleString("en-US")}.</p>
      ) : null}
    </div>
  );
}
