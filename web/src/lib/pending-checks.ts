// Checks a signed-in person started and may have walked away from. The
// report page adds one when its check starts and drops it when the result
// arrives there; the app's check watcher (components/check-watch.tsx) follows
// the rest and says when each is ready. Kept in localStorage, so it survives
// moving around the app and reloads. Pure, so it runs under `node --test`.
import type { Mode } from "./types";

export const PENDING_KEY = "holt:pending-checks";
/** Fired on window when this tab changes the list (storage events only reach other tabs). */
export const PENDING_EVENT = "holt:pending-checks";

export interface PendingCheck {
  job: string;
  repo: string;
  mode: Mode;
  days: number;
  /** When the check started here, in ms. */
  at: number;
}

/** A check older than this has finished or failed long ago: stop following it. */
const FOLLOW_FOR_MS = 20 * 60 * 1000;
const MAX = 10;

export function parsePending(raw: string | null | undefined, now: number): PendingCheck[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is PendingCheck =>
      typeof c?.job === "string" && typeof c.repo === "string" && (c.mode === "rules" || c.mode === "ai") &&
      typeof c.days === "number" && typeof c.at === "number" && now - c.at < FOLLOW_FOR_MS,
  );
}

export function withPending(list: PendingCheck[], check: PendingCheck): PendingCheck[] {
  return [...list.filter((c) => c.job !== check.job), check].slice(-MAX);
}

export function withoutPending(list: PendingCheck[], job: string): PendingCheck[] {
  return list.filter((c) => c.job !== job);
}

/** The checks to follow from `pathname`: not the one whose report page is open (it follows its own). */
export function toFollow(list: PendingCheck[], pathname: string): PendingCheck[] {
  const here = pathname.replace(/\/+$/, "").toLowerCase();
  return list.filter((c) => `/${c.repo.toLowerCase()}` !== here);
}
