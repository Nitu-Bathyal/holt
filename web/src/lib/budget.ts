// The reader's time budget: how long they can wait for a first reply. The
// report is computed for it (`days`); only the "replies are slow" note
// changes with it, never the verdict, and the server answers another budget
// from the same read. The report page no longer offers a choice: it uses the
// default, and a `?days=` in the address still works.

export const DEFAULT_DAYS = 7;

/** A budget from the `days` query parameter: a whole number of days, 1–90. */
export function budgetFrom(raw: string | string[] | undefined): number {
  const d = Math.round(Number(Array.isArray(raw) ? raw[0] : raw));
  return Number.isFinite(d) && d >= 1 && d <= 90 ? d : DEFAULT_DAYS;
}

/** The report page's address for a budget; the default one needs no parameter. */
export function reportHref(repo: string, days: number, mode: "rules" | "ai" = "rules"): string {
  const q = new URLSearchParams();
  if (mode === "ai") q.set("mode", "ai");
  if (days !== DEFAULT_DAYS) q.set("days", String(days));
  const s = q.toString();
  return `/${repo}${s ? `?${s}` : ""}`;
}
