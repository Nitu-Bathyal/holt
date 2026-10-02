// A list that arrives in parts: the first with the page, the rest as the
// reader nears the end (components/shell/load-more.tsx draws it). This is the
// state and its steps only: what is shown, where the next part starts, and
// whether one is on its way or failed. Nothing here knows what the items are
// or where they come from, so any list can use it. Pure, so it runs under
// `node --test`.

/** One part: its items, and where the part after it starts (null: there is none). */
export interface Part<T, C = number> {
  items: T[];
  next: C | null;
}

export interface Paged<T, C = number> extends Part<T, C> {
  status: "idle" | "loading" | "failed";
  /** Parts taken in so far, the first included. */
  parts: number;
}

/** `items` followed by those of `more` it doesn't already hold, by `key`. */
export function withoutRepeats<T>(items: T[], more: T[], key: (item: T) => string): T[] {
  const seen = new Set(items.map(key));
  const out = [...items];
  for (const item of more) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function startList<T, C = number>(first: Part<T, C>, key: (item: T) => string): Paged<T, C> {
  return { items: withoutRepeats([], first.items, key), next: first.next, status: "idle", parts: 1 };
}

/** Nothing is left to load. */
export function ended<T, C>(list: Paged<T, C>): boolean {
  return list.next === null;
}

/** The part to ask for now, or null: at the end, or one is already on its way. */
export function wanted<T, C>(list: Paged<T, C>): C | null {
  return list.status === "loading" ? null : list.next;
}

export function loading<T, C>(list: Paged<T, C>): Paged<T, C> {
  return wanted(list) === null ? list : { ...list, status: "loading" };
}

/**
 * The part asked for at `cursor` arrived. An answer nobody is waiting for (a
 * second request for the same part) changes nothing. A part that points back
 * at itself would load forever, so it ends the list.
 */
export function loaded<T, C>(list: Paged<T, C>, cursor: C, part: Part<T, C>, key: (item: T) => string): Paged<T, C> {
  if (list.status !== "loading" || list.next !== cursor) return list;
  return {
    items: withoutRepeats(list.items, part.items, key),
    next: part.next === cursor ? null : part.next,
    status: "idle",
    parts: list.parts + 1,
  };
}

/** The part asked for at `cursor` didn't arrive: what is shown stays, and it can be asked for again. */
export function failed<T, C>(list: Paged<T, C>, cursor: C): Paged<T, C> {
  if (list.status !== "loading" || list.next !== cursor) return list;
  return { ...list, status: "failed" };
}
