# 004 — `openai_compat` meta-provider with presets, native shims kept in parallel

Date: 2026-04-27 (retroactive — work landed across [#140](https://github.com/sigrorn/mchat2/issues/140), [#169](https://github.com/sigrorn/mchat2/issues/169), [#170](https://github.com/sigrorn/mchat2/issues/170), [#171](https://github.com/sigrorn/mchat2/issues/171))
Status: Accepted

## Decision

Replace the standalone `apertus` adapter's role-as-provider with a generic `openai_compat` meta-provider that resolves through a **preset table**. Built-in presets ship for the main hosts a single user is likely to combine in a multi-persona setup: **OpenRouter, OVHcloud, IONOS, Infomaniak**. A "Custom" entry handles everything else (vLLM, Ollama, self-hosted endpoints, third-party aggregators).

Each preset owns: a URL template with `{TEMPLATE_VAR}` placeholders, a template-vars dictionary, optional extra headers, hosting country code, and `requiresKey` / `supportsUsageStream` flags. The persona's `openaiCompatPreset` column points to either a built-in id or a custom name; resolution at send time merges the preset's template with the user's stored API key (keychain) and template-var values (settings).

The legacy `apertus` adapter stays alive in parallel during transition — same persona shape, hard-coded `/2/ai/{productId}/openai/v1/chat/completions` URL — so existing personas don't break and a side-by-side comparison was possible while the meta-provider stabilized.

## Alternatives considered

- **Keep `apertus` as-is and add per-host adapters** (one for OpenRouter, one for OVHcloud, etc.). *Not chosen* — the protocol is identical, the per-host divergence is in URL templating and headers; duplicating the streaming machinery would have multiplied the maintenance surface.
- **One generic adapter, no preset table.** *Not chosen* — the user would have to hand-enter a URL, headers, and template vars for every persona. Presets are pure ergonomics built on top of the generic resolver.
- **Drop the `apertus` adapter immediately.** *Not chosen* — risk-averse. Multi-persona setups with mixed providers would have lost their working Apertus persona during migration; dual-track buys time to validate the meta-provider end-to-end.

## Tradeoff

Two paths to the same Infomaniak endpoint exist (legacy `apertus`, new `openai_compat (Infomaniak)` preset) — slightly confusing during the transition window, but the alternative was a flag day. The header-disclosure work in [#203](https://github.com/sigrorn/mchat2/issues/203) makes the active path visible per-message. Once the meta-provider has carried the user through a representative range of operations without surprises, the `apertus` adapter is a candidate for removal.
