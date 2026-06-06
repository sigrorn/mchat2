# 013 — Persistent model cache with stale-while-revalidate + startup warm

Date: 2026-06-06 ([#297](https://github.com/sigrorn/mchat2/issues/297))
Status: Accepted

## Decision

Persist each provider's discovered model list to the `settings` table
(`model_cache.<cacheKey>` → `{ at, infos }`) on every successful live fetch. In
`listModelInfos`, serve **stale-while-revalidate**: return a fresh in-memory hit
as before; otherwise return the last persisted list immediately and trigger a
background refresh that updates both caches and notifies subscribers; otherwise
do the live fetch. On a fetch error, fall back to the last persisted list rather
than an empty array. At startup, after migrations, fire a non-blocking
background discovery for every configured provider/preset so the cache is fresh
for the session.

## Context

Model lists were fetched live with a 10-minute **in-memory** cache
(`infoCache`), discarded on every restart. The `openai_compat` failure fallback
was an empty list, so any cold start that couldn't reach the network (or hit the
allowlist bug, #297) showed an empty model picker with no recourse. The user
asked for background discovery that caches the previous result and reloads on
restart so the next access is fresh.

The `settings` repository (`getSetting`/`setSetting`, Kysely-backed, #201)
already provides a flat key/value keyspace — no new table needed. The existing
`cacheKeyFor` already produces a stable per-provider/per-preset key.

## Alternatives considered

1. **Keep in-memory only, just lengthen the TTL.** Doesn't survive restart —
   fails the core request. Rejected.
2. **Always-fresh blocking fetch on open.** Simial to today minus the cache;
   shows a spinner/empty list on every cold open and breaks offline. Rejected —
   the whole point is instant population from the last known good list.
3. **New dedicated `model_cache` table.** More schema/migration surface for
   data that is pure disposable cache. Rejected — the flat settings keyspace is
   the established convention for this kind of non-secret blob.

## Tradeoff

- **UX win:** the picker populates instantly from disk, works offline, and
  self-heals when the network returns. The startup warm means the list is
  usually already fresh by the time the user opens the Personas dialog.
- **Staleness window:** the user may briefly see a model list one fetch old
  (e.g. a brand-new model not yet shown). Bounded by the background refresh and
  acceptable for a convenience picker where free-text entry is always available.
- **Live UI update:** a small module-level subscriber set lets an open dialog
  re-read when a background refresh changes the list, so "next access" is often
  "this access." Costs one effect subscription in `useModelOptions`.
- **Cache invalidation:** entries are overwritten on every successful fetch and
  keyed by provider+preset; a removed preset's stale entry is harmless (never
  read). No explicit eviction needed.
