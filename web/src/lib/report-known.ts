// Does Holt have a report for this repository? The proxy asks before it lets
// a shared cache keep a signed-out report page (lib/edge-cache.ts): a repo
// with no report gets a page that offers to run the check, with a ticket that
// expires, and that page must never be kept.
//
// A report, once made, stays (a newer one replaces it), so "yes" is
// remembered for a while and costs nothing to ask again. "No" is asked again
// every time: the first check turns it into "yes". A failed lookup counts as
// "no". No runtime imports, so it runs under `node --test`.

export type ReportProbe = (repo: string) => Promise<boolean>;

export function reportKnownChecker({
  probe,
  now = Date.now,
  knownMs = 10 * 60_000,
  maxEntries = 5000,
}: {
  probe: ReportProbe;
  now?: () => number;
  knownMs?: number;
  maxEntries?: number;
}): (repo: string) => Promise<boolean> {
  const known = new Map<string, number>();
  const inflight = new Map<string, Promise<boolean>>();

  return async (repo) => {
    const key = repo.toLowerCase();
    const until = known.get(key);
    if (until !== undefined && until > now()) return true;
    const running = inflight.get(key);
    if (running) return running;

    const p = probe(repo)
      .catch(() => false)
      .then((found) => {
        known.delete(key);
        if (found) known.set(key, now() + knownMs);
        // Map keeps insertion order: drop the oldest entries first.
        while (known.size > maxEntries) known.delete(known.keys().next().value!);
        return found;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
