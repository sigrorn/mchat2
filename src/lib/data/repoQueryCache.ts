// ------------------------------------------------------------------
// Component: repoQueryCache
// Responsibility: Framework-agnostic core of useRepoQuery (#183).
//                 Caches resolved values by stringified key, dedups
//                 in-flight fetches, supports prefix-keyed
//                 invalidation. The React hook is a thin wrapper.
// Collaborators: lib/data/useRepoQuery (React adapter).
// Decision context: docs/decisions/006-data-layer.md.
// ------------------------------------------------------------------

export type QueryKey = readonly unknown[];

export interface RepoQueryCache {
  /**
   * Returns the cached value for `key`, or invokes `fn` to produce it
   * (caching the result on success). Concurrent calls with the same
   * key share a single in-flight promise.
   */
  fetch: <T>(key: QueryKey, fn: () => Promise<T>) => Promise<T>;
  /**
   * Drop all entries whose key starts with `keyPrefix`. Pass `[]` to
   * flush everything.
   */
  invalidate: (keyPrefix: QueryKey) => void;
  /**
   * In-place update of the cached value for `key`. No-op if `key` is
   * not currently cached (avoids inserting wrong-shape stubs from
   * partial updaters). Notifies matching subscribers.
   *
   * Used by streaming patches that don't want to trigger a full
   * refetch — e.g. patching one message's content during token
   * streaming.
   */
  update: <T>(key: QueryKey, fn: (current: T) => T) => void;
  /**
   * Direct write to the cache. Used when the caller has already
   * fetched the value through another channel (e.g. a Zustand store
   * that loaded the same data) and wants the cache to mirror it
   * without re-issuing the query.
   */
  set: <T>(key: QueryKey, value: T) => void;
  /**
   * Subscribe to invalidate events for keys matching `keyPrefix`. The
   * React hook uses this to trigger re-renders. Returns an unsubscribe.
   */
  subscribe: (keyPrefix: QueryKey, listener: () => void) => () => void;
}

function serializeKey(key: QueryKey): string {
  // JSON.stringify is sufficient for primitive-array keys, which is
  // what call sites use. Keys containing functions or symbols are
  // not supported (and shouldn't be used for cache keys anyway).
  return JSON.stringify(key);
}

function keyMatchesPrefix(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (!Object.is(key[i], prefix[i])) return false;
  }
  return true;
}

export function createRepoQueryCache(): RepoQueryCache {
  const resolved = new Map<string, unknown>();
  const inFlight = new Map<string, Promise<unknown>>();
  const keys = new Map<string, QueryKey>();
  const listeners: Array<{ prefix: QueryKey; listener: () => void }> = [];

  function notifyKey(key: QueryKey): void {
    for (const { prefix, listener } of listeners) {
      if (keyMatchesPrefix(key, prefix) || keyMatchesPrefix(prefix, key)) {
        listener();
      }
    }
  }

  return {
    async fetch<T>(key: QueryKey, fn: () => Promise<T>): Promise<T> {
      const k = serializeKey(key);
      if (resolved.has(k)) return resolved.get(k) as T;
      const existing = inFlight.get(k);
      if (existing) return existing as Promise<T>;
      const promise = (async () => {
        try {
          const value = await fn();
          resolved.set(k, value);
          keys.set(k, key);
          return value;
        } finally {
          inFlight.delete(k);
        }
      })();
      inFlight.set(k, promise);
      return promise;
    },
    update<T>(key: QueryKey, fn: (current: T) => T) {
      const k = serializeKey(key);
      if (!resolved.has(k)) return;
      const next = fn(resolved.get(k) as T);
      resolved.set(k, next);
      notifyKey(key);
    },
    set<T>(key: QueryKey, value: T) {
      const k = serializeKey(key);
      resolved.set(k, value);
      keys.set(k, key);
      notifyKey(key);
    },
    invalidate(keyPrefix) {
      for (const [k, queryKey] of keys.entries()) {
        if (keyMatchesPrefix(queryKey, keyPrefix)) {
          resolved.delete(k);
          keys.delete(k);
        }
      }
      // A listener fires when its subscription prefix overlaps the
      // invalidate prefix in either direction — invalidating
      // ['messages'] should wake a listener subscribed to
      // ['messages', 'c_1'], and vice versa.
      notifyKey(keyPrefix);
    },
    subscribe(keyPrefix, listener) {
      const entry = { prefix: keyPrefix, listener };
      listeners.push(entry);
      return () => {
        const idx = listeners.indexOf(entry);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}
