# 016 — UI state vs persistent state (single read cache)

Status: accepted (Phase 1 of #318; supersedes the "dual cache" framing in ADR 006)

## Decision

There is **one** read cache for repo-loaded entities: the repo-query
cache behind `src/lib/data/useRepoQuery.ts`. Zustand stores hold
**UI-only** state and **never** own a second entity cache. The rule:

- **May live in a Zustand store:** selection (`currentId`,
  `selectionByConversation`), modal/UI flags, bootstrap flags
  (`loaded`), composer state, in-flight stream state (run ids, active
  streams, per-target status, submitting), `supersededByConversation`,
  `editingByConversation`, `replayQueue`, and scalar settings mirrored
  for synchronous reads (`uiStore` font scale / working dir / debug).
- **Must NOT live in a store:** any collection loaded from a repo
  (conversations, personas, messages, flows). These are read through
  `useRepoQuery(["<entity>", ...])`; the query cache is the single
  source of truth for them.

## Current state (inventory)

The dual cache is **already substantially collapsed** — the review
(2026-06-10) predates the #287/#290/#291 work that routed store caches
through `getRepoQueryCache()`. Per store:

- **`conversationsStore`** — UI: `currentId`, `loaded` ✅. Entity reads:
  `conversationsList()` / `cacheGet()` already delegate to
  `getRepoQueryCache()` under `CONVERSATIONS_KEY`. Gap: the store still
  owns the write-through + cache-patch helpers (`cacheUpdate`/`cacheSet`)
  and exposes a sync `conversationsList()` accessor.
- **`personasStore`** — UI: `selectionByConversation` ✅. Entity reads:
  `cacheSet`/`cacheUpdate` already target
  `getRepoQueryCache()[personasQueryKey]`. Gap: store still owns the
  sort_order optimistic patch (#273) and the list write helpers.
- **`messagesStore`** — UI: `supersededByConversation`,
  `editingByConversation`, `replayQueue` ✅ (STAY). Entity reads: the
  message list lives in `getRepoQueryCache()[messagesQueryKey]`; the
  streaming token patch uses the in-place `cache.update` mechanism
  (#184) and MUST keep doing so. Gap: many write actions still live on
  the store.
- **`flowsStore`** — already the target shape: a thin
  write-then-`invalidateRepoQuery` wrapper; reads go through
  `useRepoQuery(["flow", ...])`. No entity cache. ✅
- **`sendStore`** — all in-flight stream/UI state. No entity cache. ✅
- **`uiStore`** — font scale, working dir, debug session, find. UI /
  scalar settings only. No entity collection. ✅

So **no store holds a *separate* entity collection today** — the
acceptance's hard requirement ("no Zustand store holds repo-loaded
entity collections; useRepoQuery is the single read cache") is in
substance already met at the cache layer. What remains is **ergonomic**:
the stores still own the write-through/optimistic/patch/reload helpers,
so the four documented update patterns still exist as code paths even
though they all target one cache.

## Alternatives considered

1. **Big-bang rewrite** of all stores at once. Rejected: messages is the
   hot streaming path; a render regression there is the worst failure
   mode and needs an isolated, benchmarked change (#318 phase 4).
2. **Leave as-is** (cache already unified). Rejected: the four-pattern
   write surface is still a live source of #279-class "updated the wrong
   way" bugs; collapsing it to two patterns (write-through-invalidate,
   optimistic-with-rollback) is the remaining value.

## Tradeoff

Accept that #318's remaining phases are **cleanup of the write surface**,
not a cache re-architecture (that already happened incrementally). The
phase order stands — personas → conversations → messages → delete dead
patterns — each gated on the prior merging, with a streaming benchmark
required before the messages phase lands. Cost: several focused PRs.
Benefit: one read cache (done) **and** two write patterns instead of
four, so a mutation can no longer "update the wrong cache".
