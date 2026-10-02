// A list that loads in parts as it is scrolled (Browse's boards, Find's
// index: API.md, `cursor` and `next`). The state of one such list and what
// each event does to it, kept apart from the component so it runs under
// `node --test`. No runtime imports.
import type { ApiError } from "./types.ts";

/** One answer from the server: the items, the cursor for the part after it (null at the end) and the size of the whole list. */
export interface Part<T> {
  items: T[];
  next: string | null;
  total: number;
}

export interface Parts<T> {
  /** Everything loaded so far, in order, no item twice. */
  items: T[];
  /** How many items each part added (the first is the one the page came with). */
  sizes: number[];
  /** The cursor to ask with next; null once the end is reached. */
  next: string | null;
  total: number;
  status: "idle" | "loading" | "error";
  error: ApiError | null;
}

/** What is remembered of a list, so coming back to it finds the same parts at the same place. */
export interface SavedParts<T> {
  at: number;
  items: T[];
  sizes: number[];
  next: string | null;
  total: number;
  /** How far down the page was scrolled. */
  y: number;
}

/** The cursor that asks for a list from its start: for a first part that didn't come with a `next`. */
export const FROM_START = "";

/** Parts kept this long are shown again; older ones start over from the first. */
export const SAVED_MAX_AGE_MS = 30 * 60_000;

type Id<T> = (item: T) => string;

export function startParts<T>(first: Part<T>): Parts<T> {
  return { items: first.items, sizes: [first.items.length], next: first.next, total: first.total, status: "idle", error: null };
}

export function loadingParts<T>(s: Parts<T>): Parts<T> {
  return s.next === null ? s : { ...s, status: "loading", error: null };
}

/** The part asked for with `cursor` arrived. One that was asked for twice, or after the list moved on, changes nothing. */
export function appendPart<T>(s: Parts<T>, cursor: string, part: Part<T>, id: Id<T>): Parts<T> {
  if (s.next !== cursor) return s;
  const seen = new Set(s.items.map(id));
  const fresh = part.items.filter((item) => {
    const key = id(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // A server that hands the same cursor back with nothing new would be asked forever: that is the end.
  const next = part.next === cursor && !fresh.length ? null : part.next;
  return { items: [...s.items, ...fresh], sizes: [...s.sizes, fresh.length], next, total: part.total, status: "idle", error: null };
}

/** The part asked for with `cursor` failed: what is loaded stays, and the same cursor can be asked again. */
export function failedParts<T>(s: Parts<T>, cursor: string, error: ApiError): Parts<T> {
  return s.next === cursor ? { ...s, status: "error", error } : s;
}

/** The items part by part, as they arrived. */
export function chunks<T>(s: Parts<T>): T[][] {
  let at = 0;
  return s.sizes.map((n) => s.items.slice(at, (at += n)));
}

export function saveParts<T>(s: Parts<T>, y: number, now: number): SavedParts<T> | null {
  // Only the first part: the page brings that itself.
  return s.sizes.length > 1 ? { at: now, items: s.items, sizes: s.sizes, next: s.next, total: s.total, y } : null;
}

/**
 * The list as it was left, on top of the first part the page has now (which
 * may have changed since): that part first, then the saved ones without
 * anything already listed. Null when there is nothing worth restoring.
 */
export function restoreParts<T>(first: Part<T>, saved: SavedParts<T> | null, id: Id<T>, now: number): Parts<T> | null {
  if (!saved || now - saved.at > SAVED_MAX_AGE_MS || !Array.isArray(saved.items) || !Array.isArray(saved.sizes) || saved.sizes.length < 2) return null;
  const seen = new Set(first.items.map(id));
  const items = [...first.items];
  const sizes = [first.items.length];
  let at = saved.sizes[0];
  for (const n of saved.sizes.slice(1)) {
    const fresh = saved.items.slice(at, (at += n)).filter((item) => !seen.has(id(item)) && Boolean(seen.add(id(item))));
    items.push(...fresh);
    sizes.push(fresh.length);
  }
  if (items.length === first.items.length) return null;
  return { items, sizes, next: saved.next, total: saved.total, status: "idle", error: null };
}
