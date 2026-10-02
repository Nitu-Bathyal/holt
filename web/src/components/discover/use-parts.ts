"use client";

// A list that loads its next part as the reader nears the end (lib/parts.ts
// holds the state). The first part comes with the page; the rest is asked for
// through `load`, by an IntersectionObserver on a sentinel under the list or
// by the "load more" button (PartsFooter), which is also all there is where
// the observer can't run.
//
// Coming back to the list (the back button, a reload) shows the parts that
// were loaded, at the place it was left: they are kept per `storeKey`, in
// this tab only, for half an hour.
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { appendPart, failedParts, loadingParts, restoreParts, saveParts, startParts, type Part, type Parts, type SavedParts } from "@/lib/parts";
import type { ApiError, Result } from "@/lib/types";

const UNREACHABLE: ApiError = { code: "upstream", message: "Couldn't reach Holt. Check your connection and try again." };
/** How far above the end of the list the next part is asked for. */
const AHEAD = "0px 0px 900px 0px";
/** Lists longer than this are remembered for this visit only, not across a reload. */
const STORED_MAX = 480;
/** A list that mounts this soon after the back or forward button, at the address it went to, is that navigation's page. */
const CAME_BACK_MS = 10_000;

// What each list looked like when it was last on screen.
const memory = new Map<string, SavedParts<unknown>>();
const stored = (key: string) => `holt-parts:${key}`;

let popped = { at: -Infinity, to: "" };
// False until a component of this page has mounted: the first lists are the
// ones the browser loaded the page with.
let booted = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => (popped = { at: performance.now(), to: window.location.href }));

/** Whether this mount is the reader coming back to a page (back, forward, reload), not arriving on it. */
function cameBack(): boolean {
  if (booted) return popped.to === window.location.href && performance.now() - popped.at < CAME_BACK_MS;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "back_forward" || nav?.type === "reload";
}

function remembered<T>(key: string): SavedParts<T> | null {
  const kept = memory.get(key);
  if (kept) return kept as SavedParts<T>;
  try {
    const raw = window.sessionStorage.getItem(stored(key));
    return raw ? (JSON.parse(raw) as SavedParts<T>) : null;
  } catch {
    return null; // no storage (private mode): the list starts from its first part
  }
}

function persist(key: string) {
  try {
    const kept = memory.get(key);
    if (kept && kept.items.length <= STORED_MAX) window.sessionStorage.setItem(stored(key), JSON.stringify(kept));
    else window.sessionStorage.removeItem(stored(key));
  } catch {
    // Full or unavailable: this visit still has `memory`.
  }
}

export interface PartsList<T> {
  state: Parts<T>;
  /** Ask for the next part (or the failed one again). */
  more: () => void;
  /** Goes on an element right under the list. */
  sentinel: React.RefObject<HTMLDivElement | null>;
}

export function useParts<T>({ first, load, id, storeKey, auto = true }: {
  first: Part<T>;
  load: (cursor: string) => Promise<Result<Part<T>>>;
  /** What makes two items the same one. */
  id: (item: T) => string;
  /** Names this list among the ones remembered (its address and filters). */
  storeKey: string;
  /** False loads only on the button: for a list with more page under it. */
  auto?: boolean;
}): PartsList<T> {
  const [state, setState] = useState(() => startParts(first));
  // Another first part (a search that finished, other results) starts the
  // list over from it. The same one sent again (a page refresh behind an
  // alert, say) leaves what is loaded alone.
  const mark = `${first.items.map(id).join(" ")} > ${first.next}`;
  const [from, setFrom] = useState(mark);
  if (from !== mark) {
    setFrom(mark);
    setState(startParts(first));
  }
  const sentinel = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  // Coming back: the parts that were loaded, then the place the page was left at.
  const goTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    const saved = cameBack() ? remembered<T>(storeKey) : null;
    booted = true;
    const restored = restoreParts(first, saved, id, Date.now());
    if (restored && saved) {
      goTo.current = saved.y;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- what was loaded is only known in the browser, and must be on the page before it paints
      setState(restored);
    } else {
      // Arriving, not coming back: the list starts over, and so does what is remembered of it.
      memory.delete(storeKey);
      persist(storeKey);
    }
    return () => void (mounted.current = false);
    // Once, for the list this component mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const y = goTo.current;
    if (y === null || state.sizes.length < 2) return;
    goTo.current = null;
    // Now that the longer list is laid out; and once more a frame later, in case the browser moved the page meanwhile.
    window.scrollTo({ top: y, behavior: "instant" });
    const frame = requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [state]);

  // Remember the list as it grows, and how far down the reader is. A layout
  // effect, so it stops listening before the next page scrolls to its top.
  useLayoutEffect(() => {
    const saved = saveParts(state, window.scrollY, Date.now());
    if (!saved) return;
    memory.set(storeKey, saved);
    const onScroll = () => (saved.y = window.scrollY);
    const onHide = () => persist(storeKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      persist(storeKey);
    };
  }, [state, storeKey]);

  const more = async () => {
    const cursor = state.next;
    if (cursor === null || state.status === "loading") return;
    setState(loadingParts);
    const r = await load(cursor).catch((): Result<Part<T>> => ({ ok: false, status: 0, error: UNREACHABLE }));
    if (!mounted.current) return;
    setState((s) => (r.ok ? appendPart(s, cursor, r.data, id) : failedParts(s, cursor, r.error)));
  };
  const near = useEffectEvent(() => void more());

  // Watching only while there is a part to ask for and none on its way: a
  // failed part waits for "try again", and each new part starts a fresh look,
  // so a part that didn't fill the screen is followed by the next.
  const waiting = auto && state.status === "idle" && state.next !== null;
  const loaded = state.sizes.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!waiting || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && near(), { rootMargin: AHEAD });
    io.observe(el);
    return () => io.disconnect();
  }, [waiting, loaded]);

  return { state, more: () => void more(), sentinel };
}
