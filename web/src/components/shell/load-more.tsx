"use client";

// A list that grows as the reader nears its end (lib/paged-list.ts holds the
// state): `usePagedList` asks for the parts, `ListFoot` goes under the list
// and is what triggers them. The foot is a marker the browser watches, with a
// button for when it can't (no IntersectionObserver, or the marker never
// scrolls into view), the error and its retry, and the line that says the
// list is over. Neither knows what the items are.
import { useEffect, useRef, useState } from "react";
import { ended, failed, loaded, loading, startList, wanted, type Paged, type Part } from "@/lib/paged-list";

export interface PagedList<T> {
  items: T[];
  status: Paged<T>["status"];
  /** Nothing is left to load. */
  ended: boolean;
  /** More than the first part is on the page. */
  grew: boolean;
  /** Ask for the next part; does nothing at the end or while one is on its way. */
  more: () => void;
}

/**
 * `first` came with the page; `load` fetches the part that starts at a cursor
 * and rejects when it can't. `key` names an item, so one that comes again in a
 * later part is shown once.
 */
export function usePagedList<T, C = number>(first: Part<T, C>, load: (cursor: C) => Promise<Part<T, C>>, key: (item: T) => string): PagedList<T> {
  const [list, setList] = useState(() => startList(first, key));
  const more = () => {
    const cursor = wanted(list);
    if (cursor === null) return;
    setList(loading);
    load(cursor).then(
      (part) => setList((l) => loaded(l, cursor, part, key)),
      () => setList((l) => failed(l, cursor)),
    );
  };
  return { items: list.items, status: list.status, ended: ended(list), grew: list.parts > 1, more };
}

/** How far ahead of the end the next part is asked for. */
const AHEAD = "0px 0px 600px 0px";

/**
 * Under a paged list. `end` is the line shown once the reader has loaded their
 * way to the last part (a list that fit in its first part needs no such line).
 */
export function ListFoot({ list, end, label = "load more" }: { list: Pick<PagedList<unknown>, "status" | "ended" | "grew" | "more" | "items">; end: string; label?: string }) {
  const marker = useRef<HTMLDivElement>(null);
  const { status, more } = list;
  const count = list.items.length;
  // Watched again after every part: if the marker is still in view (a tall
  // screen, a short part), the observer's first report asks for the next one.
  // Not after a failure: that waits for the reader.
  useEffect(() => {
    const el = marker.current;
    if (!el || status !== "idle" || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) more();
    }, { rootMargin: AHEAD });
    io.observe(el);
    return () => io.disconnect();
    // `more` is new on every render and reads the list as of this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, count]);

  if (list.ended) {
    return list.grew ? <p className="mt-8 border-t border-line pt-4 text-center font-sans text-[0.86rem] text-faint">{end}</p> : null;
  }
  return (
    <div className="mt-8 flex min-h-11 flex-wrap items-center justify-center gap-x-4 gap-y-2 font-sans text-[0.88rem]">
      <div ref={marker} aria-hidden="true" className="h-px basis-full" />
      {status === "failed" ? (
        <p role="alert" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-orange">
          Couldn&apos;t load more.
          <button type="button" onClick={more} className="btn-ghost">try again</button>
        </p>
      ) : (
        <button type="button" onClick={more} disabled={status === "loading"} aria-busy={status === "loading"} className="btn-ghost disabled:opacity-60">
          {status === "loading" ? "loading…" : label}
        </button>
      )}
    </div>
  );
}
