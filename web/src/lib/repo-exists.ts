// Is there a public repository at github.com/{owner}/{repo}? The proxy asks
// before the report page starts streaming, because once it streams the status
// is 200 whatever happens (the page has a loading.tsx). Without this check a
// typo got a 200 "Worth your time?" page, a soft 404.
//
// Only a plain 404 from GitHub counts as missing. Timeouts, rate limits and
// other errors count as "exists": the report page then runs as before and
// shows its own error, so a GitHub hiccup never hides a real repository.

export type Probe = (repo: string) => Promise<"exists" | "missing" | "unknown">;

const HOUR = 3_600_000;

export function repoExistsChecker({
  probe,
  now = Date.now,
  existsMs = 6 * HOUR,
  missingMs = 10 * 60_000,
  unknownMs = 60_000,
  maxEntries = 5000,
}: {
  probe: Probe;
  now?: () => number;
  existsMs?: number;
  missingMs?: number;
  unknownMs?: number;
  maxEntries?: number;
}): (repo: string) => Promise<boolean> {
  const cache = new Map<string, { exists: boolean; until: number }>();
  const inflight = new Map<string, Promise<boolean>>();

  return async (repo) => {
    const key = repo.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.exists;
    const running = inflight.get(key);
    if (running) return running;

    const p = probe(repo)
      .catch(() => "unknown" as const)
      .then((r) => {
        const ttl = r === "exists" ? existsMs : r === "missing" ? missingMs : unknownMs;
        cache.delete(key);
        cache.set(key, { exists: r !== "missing", until: now() + ttl });
        // Map keeps insertion order: drop the oldest entries first.
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
        return r !== "missing";
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

/** HEAD github.com/{repo}: 404 is missing (or private), 2xx/3xx (renamed) exists. */
export async function probeGitHub(repo: string, timeoutMs = 1500): Promise<"exists" | "missing" | "unknown"> {
  try {
    const res = await fetch(`https://github.com/${repo}`, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return "missing";
    return res.status < 400 ? "exists" : "unknown";
  } catch {
    return "unknown";
  }
}
