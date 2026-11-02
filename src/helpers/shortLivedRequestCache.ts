/**
 * Component-scoped, short-lived read de-duplication for expensive aggregate APIs.
 * Never persists data across pages or sessions. Explicit refresh and mutations
 * bypass the cache. Authorization must still be enforced by Core on every
 * uncached request; this is only for non-sensitive directory counters.
 */
export function createShortLivedRequestCache<T>(
  ttlMs: number,
  now: () => number = Date.now
) {
  const values = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  let revision = 0;

  function invalidate(): void {
    revision += 1;
    values.clear();
    inFlight.clear();
  }

  function load(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
    if (force) invalidate();

    const cached = values.get(key);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.value);
    if (cached) values.delete(key);

    const existing = inFlight.get(key);
    if (existing) return existing;

    const startedAtRevision = revision;
    const task = Promise.resolve()
      .then(fetcher)
      .then((value) => {
        if (startedAtRevision === revision) {
          values.set(key, { value, expiresAt: now() + ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(key) === task) inFlight.delete(key);
      });

    inFlight.set(key, task);
    return task;
  }

  return { load, invalidate };
}
