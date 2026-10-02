// One answer shared by every render in this process for a while: for a
// server-wide fact that pages ask about on each request. Pure, so it runs
// under `node --test`.

/**
 * `read` returns the value, or null when it couldn't be read. A value is kept
 * for `ttlMs`; a failed read keeps the last value (else `fallback`) and is
 * tried again after `retryMs`. Callers that arrive during a read share it.
 */
export function ttlMemo<T>(read: () => Promise<T | null>, o: { ttlMs: number; retryMs: number; fallback: T; now?: () => number }): () => Promise<T> {
  const now = o.now ?? Date.now;
  let value = o.fallback;
  let until = -Infinity;
  let pending: Promise<T> | null = null;
  return () => {
    if (now() < until) return Promise.resolve(value);
    pending ??= read()
      .catch(() => null)
      .then((v) => {
        if (v !== null) value = v;
        until = now() + (v !== null ? o.ttlMs : o.retryMs);
        pending = null;
        return value;
      });
    return pending;
  };
}
