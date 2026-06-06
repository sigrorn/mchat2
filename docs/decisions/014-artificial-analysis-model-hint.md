# 014 — Model quality hint via Artificial Analysis (user-keyed, non-reasoning, fuzzy mapping)

Date: 2026-06-06 ([#299](https://github.com/sigrorn/mchat2/issues/299))
Status: Accepted

## Decision

Surface Artificial Analysis's **Intelligence Index** (0–100) as an optional
third segment on the model picker's secondary line (`… · AA 64`). Data comes
from one call to `GET https://artificialanalysis.ai/api/v2/data/llms/models`
(`x-api-key` header), which returns every tracked model at once. Each user
supplies their own free AA key, stored in the OS keychain; the whole feature is
**silent without a key** (no fetch, no scores, no error). The full model list is
cached persistently with a 24h TTL using the stale-while-revalidate machinery
from ADR 013. AA is **not** added to `PROVIDER_REGISTRY` — it is a benchmark data
source, not a chat provider.

## Context

#298 added price + context to the picker; the natural next axis is "how good is
this model". AA publishes a normalized cross-vendor intelligence score with a
free API. Constraints from their docs: cache responses, don't embed the key in
client code, and attribute the source. A desktop app embedding a shared key
would violate the second rule, so per-user keys are the only clean fit — and
they double as the on/off switch.

## Alternatives considered

1. **LMArena Elo instead of AA.** No free HTTP API (only an HF dataset or
   enterprise endpoint); identifiers are worse-normalized. Rejected as the
   primary source; AA's structured endpoint is cleaner. Could be added later.
2. **Add AA to `PROVIDER_REGISTRY`.** Would reuse the per-provider key UI but
   pollute the `ProviderId` union, prefix maps, and persona resolver for a thing
   you never chat with — the exact cost ADR 010 warned about. Rejected; key lives
   under a fixed keychain slot and a standalone module.
3. **Ship a bundled static score table.** No key needed, but stale immediately,
   unmaintainable, and still has the mapping problem. Rejected.
4. **Show the reasoning-variant or highest score.** AA splits one model into
   several entries by reasoning mode. mchat2's adapters send no thinking/
   reasoning params (plain mode only), so the **non-reasoning/base** variant is
   the honest number; fall back to a reasoning variant only when no plain entry
   exists. Revisit if a thinking toggle is ever added.

## Tradeoff

- **Opt-in & silent:** zero footprint until a key is set; no errors ever shown
  for the no-key path. Costs the user a one-time free signup to benefit.
- **Partial coverage:** AA's slugs don't cleanly join our native / OpenRouter
  ids (version granularity differs, e.g. `claude-sonnet-4` vs `claude-sonnet-4-6`).
  Matching is best-effort — exact normalized → curated alias map → guarded
  version-suffix prefix — so some models show no score. A blank is acceptable;
  a wrong score is not, hence the conservative matcher.
- **Staleness:** a 24h-old score is fine for a slow-moving benchmark; the
  background refresh keeps it current without blocking the picker.
- **External dependency / attribution:** adds a network dependency and a mandated
  attribution link in Settings. The slim cached blob (slug/creator/score only)
  keeps the persisted footprint small.
