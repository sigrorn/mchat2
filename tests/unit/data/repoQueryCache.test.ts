// repoQueryCache — the framework-agnostic core of useRepoQuery
// (#183). Caches by stringified key, dedups in-flight queries,
// supports prefix-keyed invalidation. The React hook is a thin
// adapter; the cache itself is testable in plain TS.
import { describe, it, expect } from "vitest";
import { createRepoQueryCache } from "@/lib/data/repoQueryCache";

describe("repoQueryCache", () => {
  it("returns a cached value on repeat lookups for the same key", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    const fn = async () => {
      calls++;
      return 42;
    };
    const a = await cache.fetch(["x"], fn);
    const b = await cache.fetch(["x"], fn);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it("dedups in-flight queries for the same key", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    let resolve!: (v: number) => void;
    const fn = () =>
      new Promise<number>((r) => {
        calls++;
        resolve = r;
      });
    const p1 = cache.fetch(["x"], fn);
    const p2 = cache.fetch(["x"], fn);
    resolve(7);
    expect(await p1).toBe(7);
    expect(await p2).toBe(7);
    // The second fetch joins the in-flight promise rather than
    // starting its own.
    expect(calls).toBe(1);
  });

  it("treats different keys as independent entries", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    const fn = async (n: number) => {
      calls++;
      return n;
    };
    await cache.fetch(["x", 1], () => fn(1));
    await cache.fetch(["x", 2], () => fn(2));
    expect(calls).toBe(2);
  });

  it("invalidate(keyPrefix) drops all entries whose key starts with the prefix", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    const fn = async () => ++calls;
    await cache.fetch(["messages", "c_1"], fn);
    await cache.fetch(["messages", "c_2"], fn);
    await cache.fetch(["personas", "c_1"], fn);
    cache.invalidate(["messages"]);
    // Re-fetch — messages-prefixed entries miss; personas-prefixed hits.
    await cache.fetch(["messages", "c_1"], fn);
    await cache.fetch(["personas", "c_1"], fn);
    // 3 initial + 1 messages re-fetch = 4. Personas was a hit.
    expect(calls).toBe(4);
  });

  it("invalidate with empty prefix flushes everything", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    const fn = async () => ++calls;
    await cache.fetch(["a"], fn);
    await cache.fetch(["b"], fn);
    cache.invalidate([]);
    await cache.fetch(["a"], fn);
    await cache.fetch(["b"], fn);
    expect(calls).toBe(4);
  });

  it("propagates the underlying promise rejection without caching it", async () => {
    const cache = createRepoQueryCache();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cache.fetch(["x"], fn)).rejects.toThrow("boom");
    // Errors are NOT cached — a retry restarts the fetch.
    const value = await cache.fetch(["x"], fn);
    expect(value).toBe("ok");
    expect(calls).toBe(2);
  });
});
