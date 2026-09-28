// "Holt users who sent pull requests here": the line under a report's numbers.
// Pure, so it can be tested without React.
import type { Report } from "./types";

export type HoltUsers = NonNullable<Report["holt_users"]>;

/** "7 of 12 merged, 3 still open (from 9 people)". The server sends the numbers
 * only when 5+ people make them up, so the counts are never singular. */
export function holtUsersLine(h: HoltUsers): string {
  const open = h.waiting > 0 ? `, ${h.waiting} still open` : "";
  return `${h.merged} of ${h.pull_requests} merged${open} (from ${h.people} people)`;
}

/** "the last 12 months" for 365 days, else "the last N days". */
export function windowLabel(days: number): string {
  return days === 365 ? "the last 12 months" : `the last ${days} days`;
}
