# 010 — Drop the native apertus provider; converge on openai_compat

## Decision

Retire the standalone `apertus` native provider. The Infomaniak endpoint
it exposed lives on as the `openai_compat` provider's built-in
`infomaniak` preset, with the product id moved from a per-persona
column on `personas` to a global template variable on the
`openai_compat.config.builtins.infomaniak.templateVars.PRODUCT_ID`
setting. Existing data auto-converts at conversation activation
(Phase 0); new data can't reach the legacy provider since Phase A
hides it from every UI surface and Phase B removes the runtime.

## Context

When the openai_compat preset registry landed (#140 → #169), Infomaniak
became one of four built-in presets sharing the same template-URL +
Bearer-key wire format. The native `apertus` adapter survived as a
parallel path because it carried per-persona productId state that
the openai_compat resolver couldn't yet hold. Once the openai_compat
config gained `templateVars` (#170), there was no longer a meaningful
behavioural difference between the two paths — only friction every
time the persona shape changed.

## Alternatives considered

1. **Keep both adapters indefinitely.** Lowest immediate cost but
   compounding maintenance: every new persona-level feature has to
   thread `apertusProductId` and consult `PROVIDER_REGISTRY.apertus`
   alongside the rest of the providers. Rejected — the cost is
   ongoing and the user-facing benefit is zero (same wire format,
   same models, same billing).

2. **Replace apertus internals with a thin wrapper around
   `openaiCompatTemplated`.** Removes the duplicated streaming code
   but keeps the apertus identity in the registry / type union /
   keychain key. Rejected — leaves all the schema / type / settings
   surface area in place for no semantic gain.

3. **Migrate aggressively in a single commit.** Drop the registry
   entry, type union, adapter, column, and aliases at once. Rejected —
   risks leaving conversations with un-converted apertus rows after
   restart. The phased path (0/A/B/C/D) lets Phase 0's runtime
   conversion catch every legacy row at activation while the adapter
   is still alive, so Phase B's removal is a non-event.

## Tradeoff

- **One-time cost:** ~5 phases / ~7 commits / 3 migrations (29
  cost_usd, 30 inherited_history, 31 drop apertus_product_id), plus
  41 test fixtures sed-stripped.
- **Ongoing benefit:** one fewer ProviderId, one fewer adapter, one
  fewer registry entry, one fewer keychain key, one fewer settings
  key, one fewer schema column, one fewer per-persona JSON field on
  exports. Every future feature that touches Persona is simpler.
- **Cost-snapshot continuity:** the four Apertus model ids live on
  under `PRICING.openai_compat`, so converted personas keep showing
  values in the spend table (#251). Pre-Phase-0 cost snapshots stay
  immutable per #252.
- **Compatibility risk:** un-converted apertus rows that survive
  Phase 0 (e.g. user upgrades and never opens a particular
  conversation before Phase B's adapter removal) lose retry
  capability for historical assistant rows. Phase 0 rewrites
  `messages.provider` to `openai_compat` for every row in the
  conversations it touches; the residual surface is "user closed
  conversation in pre-Phase-0 build, never opens it again" — which
  doesn't break anything but does mean retrying a failed historical
  apertus row from such a conversation crashes on a missing adapter.
  Acceptable: the conversation isn't being viewed.

## Status

Implemented across #254 (umbrella) → #255 #256 #257 #258 #259 in
sequence on the `flows` branch.
