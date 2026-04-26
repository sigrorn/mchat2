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
    invalidate(keyPrefix) {
      for (const [k, queryKey] of keys.entries()) {
        if (keyMatchesPrefix(queryKey, keyPrefix)) {
          resolved.delete(k);
          keys.delete(k);
        }
      }
      for (const { prefix, listener } of listeners) {
        // A listener fires when its subscription prefix overlaps the
        // invalidate prefix in either direction — invalidating
        // ['messages'] should wake a listener subscribed to
        // ['messages', 'c_1'], and vice versa.
        if (
          keyMatchesPrefix(prefix, keyPrefix) ||
          keyMatchesPrefix(keyPrefix, prefix)
        ) {
          listener();
        }
      }
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
