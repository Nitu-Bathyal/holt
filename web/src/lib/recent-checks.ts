// The footer's "recently checked" strip: the newest rules reports, one per
// repo, and how many repos have one. Built from GET /v1/reports, which returns
// at most 500 rows, so a count that hits the cap reads "500+".
// No imports beyond types, so it runs under `node --test`.

export interface RecentChecks {
  /** Repos with a report, up to the cap. */
  checked: number;
  /** True when the list was cut off at the cap: say "500+", not "500". */
  capped: boolean;
  /** Newest first. */
  recent: { repo: string; generated_at: string }[];
}

export const REPORTS_CAP = 500;
export const SHOWN = 14;

export function recentChecks(rows: { repo: string; generated_at: string }[], cap = REPORTS_CAP, shown = SHOWN): RecentChecks {
  const seen = new Set<string>();
  const unique = [...rows]
    .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
    .filter((r) => {
      const k = r.repo.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return { checked: unique.length, capped: rows.length >= cap, recent: unique.slice(0, shown).map(({ repo, generated_at }) => ({ repo, generated_at })) };
}

/** "126 repos checked so far", "500+ repos checked so far", or "" when there are none. */
export function checkedLabel(r: Pick<RecentChecks, "checked" | "capped">): string {
  if (!r.checked) return "";
  if (r.capped) return `${r.checked}+ repos checked so far`;
  return `${r.checked} repo${r.checked === 1 ? "" : "s"} checked so far`;
}
