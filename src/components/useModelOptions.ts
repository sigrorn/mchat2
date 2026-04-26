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
import type { ProviderId } from "@/lib/types";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { listModelInfos, type ModelInfo } from "@/lib/providers/models";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { PRICING } from "@/lib/pricing/table";

export function useModelOptions(
  provider: ProviderId,
  enabled: boolean,
  initial: ModelInfo[] = [],
): ModelInfo[] {
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>(initial);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const key = PROVIDER_REGISTRY[provider].requiresKey
        ? await keychain.get(PROVIDER_REGISTRY[provider].keychainKey)
        : null;
      const pid = await getSetting(APERTUS_PRODUCT_ID_KEY);
      const infos = await listModelInfos(provider, key, { apertusProductId: pid });
      if (!cancelled) setModelOptions(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, provider]);

  return modelOptions;
}

// Initial seed used by PersonaRow before the async load completes —
// the local PRICING table at least gives the picker a populated list
// rather than showing it empty for one render frame.
export function modelOptionsFromPricing(provider: ProviderId): ModelInfo[] {
  return Object.keys(PRICING[provider] ?? {}).map((id) => ({ id }));
}
