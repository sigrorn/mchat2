// ------------------------------------------------------------------
// Component: Extra config resolver
// Responsibility: Build the provider-specific extraConfig object for
//                 a given persona. Currently only Apertus uses this
//                 (for its Product-Id).
// Collaborators: hooks/runOneTarget.ts, conversations/compact.ts.
// ------------------------------------------------------------------

import type { Persona } from "../types";
import { getSetting } from "../persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "../settings/keys";
import { resolveOpenAICompatPreset } from "./openaiCompatResolver";

export async function resolveExtraConfig(
  provider: string,
  persona: Persona | null,
): Promise<Record<string, unknown> | undefined> {
  if (provider === "apertus") {
    const globalProductId = await getSetting(APERTUS_PRODUCT_ID_KEY);
    const productId = globalProductId?.trim() || persona?.apertusProductId || null;
    if (!productId) return undefined;
    return { productId };
  }
  if (provider === "openai_compat") {
    // #140 → #171: persona points at a preset; the resolver joins
    // it with the persisted config + keychain into the bag the
    // adapter consumes. The apiKey rides along under `_resolvedApiKey`
    // so runOneTarget can override deps.getApiKey for this provider —
    // the provider-keyed keychain slot in the registry is a placeholder
    // and doesn't hold the real key for any specific preset.
    if (!persona?.openaiCompatPreset) return undefined;
    const resolved = await resolveOpenAICompatPreset(persona.openaiCompatPreset);
    if (!resolved) return undefined;
    return {
      url: resolved.url,
      extraHeaders: resolved.extraHeaders,
      requiresKey: resolved.requiresKey,
      supportsUsageStream: resolved.supportsUsageStream,
      _resolvedApiKey: resolved.apiKey,
    };
  }
  return undefined;
}
