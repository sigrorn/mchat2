# 006 — Data layer for persistent reads: hand-rolled repo wrapper

Date: 2026-04-27
Status: Accepted (#183)

## Decision

For the persistent-read separation tracked by [#182](https://github.com/sigrorn/mchat2/issues/182), we will **build a hand-rolled `useRepoQuery` hook** rather than adopt **TanStack Query**. The hook is ~100 lines, lives at `src/lib/data/useRepoQuery.ts`, and provides:

- `useRepoQuery<T>(key: readonly unknown[], fn: () => Promise<T>)` — `{data, loading, error}` with cache by key, dedup of in-flight queries
- `invalidate(keyPrefix: readonly unknown[])` — used by mutation paths after a write
- A pluggable test seam consistent with the existing `__setImpl` pattern in `lib/tauri/sql.ts`

A first consumer is the `getSetting(APERTUS_PRODUCT_ID_KEY)` read in `SettingsDialog`, used to validate the shape under the existing flow before #184 migrates the messages-store reads.

## Alternatives considered

**TanStack Query.** The industry-standard React data layer. Battle-tested cache, invalidation, devtools, dedup, refetching, retries.

- *Bundle:* +~13 kB gz. Not catastrophic for a desktop app, but mchat2's vendored bundle is currently ~440 kB gz; +3 % for one feature is meaningful.
- *Test seam:* the existing dep-injection pattern under `lib/app/deps.ts` and the `__setImpl(SqlImpl)` switch in `lib/tauri/sql.ts` give us full control of "what the DB returns" in tests. TanStack Query would add a second seam to manage (mocking the queryClient) — without a corresponding gain because we're not benefiting from network-aware features.
- *Feature surface:* mchat2 has ~5 query types (messages, personas, conversations, settings, runs). No optimistic mutations, no background refetch needs (the user is the only writer), no stale-while-revalidate windows. Roughly 80 % of the library's value doesn't apply.
- *Not chosen* because the cost (bundle + second test seam + onboarding overhead for a fairly small app) exceeds the benefit.

**Status quo (Zustand-everything).** Keep persistence reads inside Zustand stores. This is what got us into the `messagesStore`/`personasStore`/`conversationsStore` confusion that #144/#168 had to unwind, and what `docs/to-mchat3-or-not-to-mchat3.md` flagged as the second-priority refactor. *Not chosen* because the structural separation is the point — that's what reduces orchestration complexity.

**Plain `useEffect + useState`.** Roll the cache call-site by call-site. *Not chosen* because the repeated boilerplate (loading flags, error boundaries, key-based caching) becomes its own maintenance load and won't enforce a consistent invalidation pattern across stores.

## Tradeoffs

- We own the cache invariants. If the cache ever needs cross-tab sync or background refetch, we'll either add it to `useRepoQuery` ourselves or migrate to TanStack Query. Future-revisit trigger: any one of (a) cross-process writers appear, (b) we need optimistic updates, (c) the cache invalidation logic exceeds ~50 lines.
- The hook is small enough that a future migration to TanStack Query is a contained rewrite — call sites use a hook signature compatible with TanStack's `useQuery`, so the mechanical move is mostly imports.

## Migration order (locked by #182)

1. **#183** (this issue): scaffolding + one example call site.
2. **#184**: messagesStore reads — biggest blast radius first.
3. **#185**: personasStore reads.
4. **#186**: conversationsStore reads.
5. **#187**: settings/sendStore residuals + ESLint tripwire.

Mutations stay on the Zustand stores until `lib/app` fully owns them (later cleanup). Selection state, panel-open flags, replay queue, active-stream registry — all UI state — stay on Zustand permanently.
