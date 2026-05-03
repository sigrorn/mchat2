// ------------------------------------------------------------------
// Component: Per-model context-window lookup (#261)
// Responsibility: Resolve a (provider, model) pair to its max input
//                 context window. Mirrors the PRICING table shape
//                 (#251-#253) so the openai_compat preset family —
//                 which hosts many models with windows from 8k to
//                 1M+ — can report and enforce realistic limits
//                 instead of the umbrella provider's `Infinity`.
//                 Native providers (one model family per provider)
//                 fall through to the registry's per-provider value
//                 unchanged.
// Collaborators: providers/registry, types/persona, every consumer
//                of provider max-context (autocompactCheck,
//                postResponseCheck, runCompaction, runOneTarget,
//                streamRunner, MessageList, stats, personasInfo,
//                limitsizeNotice, system command).
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import type { Persona } from "../types/persona";
import { PROVIDER_REGISTRY } from "./registry";

// Per-model max context tokens, keyed by [providerId][modelId]. Only
// listed models override the provider-level default; everything else
// falls through. Mirrors the PRICING table shape in pricing/table.ts
// — same provider keys, same modelId conventions — so adding a model
// to one and forgetting the other is easy to spot in review.
//
// openai_compat is the load-bearing entry: its registry default is
// Infinity (no single value fits all four presets), so every model
// the user might select on Infomaniak / IONOS / OVHcloud / OpenRouter
// SHOULD have an entry here. Unknown openai_compat models still fall
// through to Infinity — autocompact won't fire and outbound truncation
// is a no-op, but at least the path is now resolver-driven so adding
// a missing entry is a one-line patch.
//
// Apertus 70B Instruct now reflects the model's documented 64k window
// (#261 follow-up): the legacy 16384 value came from #55, which was
// set in response to an HTTP 400 from Infomaniak's earlier deployment.
// Empirically retested on 2026-05-03 with a ~22k-token sentinel prompt
// — the wire accepted it and the model recalled a codeword placed at
// the head of the prompt, proving Infomaniak's current Apertus 2509
// deployment honors the full upstream window. If they later cap below
// 64k, the next over-budget request will surface a 400 and this
// number comes back down.
export const CONTEXT_WINDOWS: Partial<Record<ProviderId, Record<string, number>>> = {
  openai_compat: {
    "swiss-ai/Apertus-70B-Instruct-2509": 65536,
    "openai/gpt-oss-120b": 131072,
    "Llama-3.3-70B-Instruct": 131072,
    "Mistral-Small-3.2-24B-Instruct-2506": 131072,
    // Kimi K2.6: 256K per Moonshot's official quickstart
    // (https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart). The
    // family (k2.5, k2-0905-preview, k2-turbo-preview, k2-thinking,
    // k2-thinking-turbo) all share the 256K window; only k2.6 is
    // confirmed selectable on Infomaniak today, so only it is listed.
    // Infomaniak caps Apertus 70B below its model-card window (16k vs
    // larger native), so this value is the upstream max — actual cap
    // may differ; bump down here if requests start failing under it.
    "moonshotai/Kimi-K2.6": 262144,
  },
};

export function maxContextTokensForProviderModel(
  provider: ProviderId,
  model: string | null | undefined,
): number {
  if (model) {
    const providerEntry = CONTEXT_WINDOWS[provider];
    if (providerEntry) {
      const m = providerEntry[model];
      if (m !== undefined) return m;
    }
  }
  return PROVIDER_REGISTRY[provider].maxContextTokens;
}

export function maxContextTokensForPersona(persona: Persona): number {
  const model = persona.modelOverride ?? PROVIDER_REGISTRY[persona.provider].defaultModel;
  return maxContextTokensForProviderModel(persona.provider, model);
}
