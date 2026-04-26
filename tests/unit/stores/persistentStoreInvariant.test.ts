// Persistent-store invariant (#187): every Zustand store that holds
// persistent rows must dual-write through the repoQueryCache so the
// data layer mirrors Zustand. The tripwire greps for the pattern
// rather than enforcing via TypeScript types — types can't easily
// express "if you call set({...}) here, you must also call
// cacheUpdate/cacheSet".
//
// Future regressions caught by this test:
// - Adding a new mutation that updates byConversation / conversations
//   without dual-writing the cache (UI sees stale data through
//   useRepoQuery)
// - Dropping a cacheSet/cacheUpdate from an existing mutation
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STORES_TO_AUDIT = [
  { file: "src/stores/messagesStore.ts", helper: "cache" },
  { file: "src/stores/personasStore.ts", helper: "cache" },
  { file: "src/stores/conversationsStore.ts", helper: "cache" },
];

describe("persistent stores dual-write through repoQueryCache (#187)", () => {
  for (const { file, helper } of STORES_TO_AUDIT) {
    it(`${file} imports the cache helpers`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).toMatch(/getRepoQueryCache|invalidateRepoQuery/);
      expect(src).toContain(helper);
    });

    it(`${file} has a cache call for every set( in mutations`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      // Crude match: count `set({` and `cacheUpdate(` / `cacheSet(`.
      // The cache calls should be at least within shouting distance.
      // A regression would either drop all cache calls (caught by the
      // import test above) or skip them in a new mutation (caught by
      // a wide gap between set() and cache count).
      const setCalls = (src.match(/\bset\(\{/g) ?? []).length;
      const cacheCalls =
        (src.match(/\bcacheUpdate\(/g) ?? []).length +
        (src.match(/\bcacheSet\(/g) ?? []).length;
      // Some set({...}) calls update only UI fields (e.g.
      // selectionByConversation, currentId) — those don't need a
      // cache call. We allow a margin: cacheCalls should be >= 1
      // and within reason of setCalls. The strict version of this
      // invariant requires per-mutation auditing; this test is a
      // smoke check.
      expect(cacheCalls).toBeGreaterThan(0);
      // If set is used 10+ times and only 1 cacheCall exists,
      // something probably regressed.
      expect(cacheCalls).toBeGreaterThanOrEqual(Math.floor(setCalls / 4));
    });
  }
});

describe("UI-only stores do NOT touch the cache (#187)", () => {
  // These stores hold UI/session state only — they should NOT
  // import or use the data-layer cache. Adding a cache call here
  // would mean some persistent state has leaked in.
  const UI_ONLY_STORES = ["src/stores/sendStore.ts", "src/stores/uiStore.ts"];
  for (const file of UI_ONLY_STORES) {
    it(`${file} does not import getRepoQueryCache`, () => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/getRepoQueryCache|cacheUpdate\b|cacheSet\b/);
    });
  }
});
