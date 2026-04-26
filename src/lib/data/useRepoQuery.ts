// ------------------------------------------------------------------
// Component: useRepoQuery
// Responsibility: React adapter on top of the repoQueryCache (#183).
//                 Returns {data, loading, error}; reruns the fetch
//                 when the key changes; subscribes to invalidates so
//                 a mutation elsewhere refreshes the consumer.
// Collaborators: lib/data/repoQueryCache (the cache singleton).
// Decision context: docs/decisions/006-data-layer.md.
// ------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { createRepoQueryCache, type QueryKey, type RepoQueryCache } from "./repoQueryCache";

let DEFAULT_CACHE: RepoQueryCache = createRepoQueryCache();

// Test seam: swap a cache for the duration of a test, restore in
// afterEach. Mirrors the __setImpl pattern used by lib/tauri/sql.
export function __setRepoQueryCache(cache: RepoQueryCache): void {
  DEFAULT_CACHE = cache;
}
export function __resetRepoQueryCache(): void {
  DEFAULT_CACHE = createRepoQueryCache();
}
export function getRepoQueryCache(): RepoQueryCache {
  return DEFAULT_CACHE;
}

export interface RepoQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRepoQuery<T>(
  key: QueryKey,
  fn: () => Promise<T>,
): RepoQueryResult<T> {
  const cache = DEFAULT_CACHE;
  const keyJson = useMemo(() => JSON.stringify(key), [key]);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    cache
      .fetch(JSON.parse(keyJson) as QueryKey, fn)
      .then((value) => {
        if (cancelled) return;
        setData(value as T);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fn intentionally not in deps — it would cause infinite refetches
    // (every render makes a new closure). Callers key on `key` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyJson, tick]);

  // Subscribe to invalidates so a mutation elsewhere triggers a refetch.
  useEffect(() => {
    const parsedKey = JSON.parse(keyJson) as QueryKey;
    const unsubscribe = cache.subscribe(parsedKey, () => setTick((t) => t + 1));
    return unsubscribe;
  }, [keyJson, cache]);

  return {
    data,
    loading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}

// Convenience for mutations: call after a write so consumers refetch.
export function invalidateRepoQuery(keyPrefix: QueryKey): void {
  DEFAULT_CACHE.invalidate(keyPrefix);
}
