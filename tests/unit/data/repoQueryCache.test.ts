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

  it("update(key, fn) replaces the cached value in place and notifies subscribers", async () => {
    const cache = createRepoQueryCache();
    await cache.fetch(["x"], async () => 1);
    let notified = 0;
    const unsub = cache.subscribe(["x"], () => notified++);
    cache.update(["x"], (v) => (v as number) + 10);
    expect(notified).toBe(1);
    // Subsequent fetch returns the updated value without re-running fn.
    let calls = 0;
    const value = await cache.fetch(["x"], async () => {
      calls++;
      return -1;
    });
    expect(value).toBe(11);
    expect(calls).toBe(0);
    unsub();
  });

  it("update on a non-cached key is a no-op (no insertion)", async () => {
    const cache = createRepoQueryCache();
    cache.update(["never-fetched"], () => 42);
    let calls = 0;
    const value = await cache.fetch(["never-fetched"], async () => {
      calls++;
      return 7;
    });
    // The fetch produces 7 because update on an absent key did NOT
    // insert a stub entry. (Avoids accidentally caching the wrong
    // shape — updaters typically have a (T)=>T signature that can't
    // produce a value from undefined safely.)
    expect(value).toBe(7);
    expect(calls).toBe(1);
  });

  it("get(key) returns the cached value synchronously, undefined if not present (#211)", async () => {
    const cache = createRepoQueryCache();
    expect(cache.get(["x"])).toBeUndefined();
    await cache.fetch(["x"], async () => "hello");
    expect(cache.get<string>(["x"])).toBe("hello");
    // Different key — independent cache entry.
    expect(cache.get(["y"])).toBeUndefined();
    // After invalidate, get returns undefined again.
    cache.invalidate(["x"]);
    expect(cache.get(["x"])).toBeUndefined();
  });

  it("get(key) reflects a value installed via set() without a fetch (#211)", async () => {
    const cache = createRepoQueryCache();
    cache.set(["x"], 42);
    expect(cache.get<number>(["x"])).toBe(42);
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
