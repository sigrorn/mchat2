// ------------------------------------------------------------------
// Component: useModelOptions
// Responsibility: Load the model picker datalist for a given provider.
//                 Reads the keychain (API key per provider), the
//                 Apertus product-id setting, and listModelInfos().
//                 Was duplicated between PersonaRow and CreateForm
//                 inside PersonaPanel.tsx (#139).
// Collaborators: lib/providers/models, lib/tauri/keychain,
//                lib/persistence/settings, lib/settings/keys.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Persona, ProviderId } from "@/lib/types";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { listModelInfos, type ModelInfo } from "@/lib/providers/models";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { PRICING } from "@/lib/pricing/table";

export interface UseModelOptionsOpts {
  // #203: persona's openai_compat preset selection. When provider is
  // openai_compat, the model picker calls /v1/models on the resolved
  // preset's base URL — preset null means free-text input (no list).
  openaiCompatPreset?: Persona["openaiCompatPreset"];
}

export function useModelOptions(
  provider: ProviderId,
  enabled: boolean,
  initial: ModelInfo[] = [],
  opts: UseModelOptionsOpts = {},
): ModelInfo[] {
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>(initial);
  // Stringify the preset so the effect's dep array can compare it
  // structurally without React's referential-equality false negatives.
  const presetKey = opts.openaiCompatPreset
    ? JSON.stringify(opts.openaiCompatPreset)
    : null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const key = PROVIDER_REGISTRY[provider].requiresKey
        ? await keychain.get(PROVIDER_REGISTRY[provider].keychainKey)
        : null;
      const pid = await getSetting(APERTUS_PRODUCT_ID_KEY);
      const extra = {
        apertusProductId: pid,
        ...(presetKey ? { openaiCompatPreset: JSON.parse(presetKey) as Persona["openaiCompatPreset"] } : {}),
      };
      const infos = await listModelInfos(provider, key, extra);
      if (!cancelled) setModelOptions(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, provider, presetKey]);

  return modelOptions;
}

// Initial seed used by PersonaRow before the async load completes —
// the local PRICING table at least gives the picker a populated list
// rather than showing it empty for one render frame.
export function modelOptionsFromPricing(provider: ProviderId): ModelInfo[] {
  return Object.keys(PRICING[provider] ?? {}).map((id) => ({ id }));
}
