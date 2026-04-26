// ------------------------------------------------------------------
// Component: useOpenAICompatPresets
// Responsibility: Load the list of configurable openai-compat presets
//                 (every built-in plus every saved custom) along with
//                 their "configured" flag — true when an API key is
//                 saved for the preset (Apertus-style requiresKey
//                 cases) or the preset doesn't need one. Powers the
//                 PersonaPanel provider dropdown's grey-out behavior
//                 in #171.
// Collaborators: openaiCompatPresets, openaiCompatStorage,
//                PersonaFormFields.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  BUILTIN_OPENAI_COMPAT_PRESETS,
  type OpenAICompatPreset,
} from "@/lib/providers/openaiCompatPresets";
import {
  loadOpenAICompatConfig,
  getApiKeyForPreset,
  type PresetRef,
} from "@/lib/providers/openaiCompatStorage";
import type { CustomPresetConfig } from "@/lib/schemas/openaiCompatConfig";

export interface ConfigurablePreset {
  ref: PresetRef;
  displayName: string;
  hostingCountry: string | null;
  configured: boolean;
}

export function useOpenAICompatPresets(): ConfigurablePreset[] {
  const [presets, setPresets] = useState<ConfigurablePreset[]>([]);

  useEffect(() => {
    void (async () => {
      const cfg = await loadOpenAICompatConfig();
      const out: ConfigurablePreset[] = [];
      // Built-ins first.
      for (const p of BUILTIN_OPENAI_COMPAT_PRESETS) {
        const ref: PresetRef = { kind: "builtin", id: p.id };
        const configured = await isBuiltinConfigured(p, cfg.builtins[p.id]);
        out.push({
          ref,
          displayName: p.displayName,
          hostingCountry: p.hostingCountry,
          configured,
        });
      }
      // Customs next, by save order.
      for (const c of cfg.customs) {
        const configured = await isCustomConfigured(c);
        out.push({
          ref: { kind: "custom", name: c.name },
          displayName: c.name,
          hostingCountry: null,
          configured,
        });
      }
      setPresets(out);
    })();
  }, []);

  return presets;
}

async function isBuiltinConfigured(
  def: OpenAICompatPreset,
  saved: { templateVars: Record<string, string> } | undefined,
): Promise<boolean> {
  if (def.requiresKey) {
    const key = await getApiKeyForPreset({ kind: "builtin", id: def.id });
    if (!key) return false;
  }
  // Every required template var must have a non-empty value.
  for (const name of def.templateVars) {
    if (!saved?.templateVars[name]?.trim()) return false;
  }
  return true;
}

async function isCustomConfigured(c: CustomPresetConfig): Promise<boolean> {
  if (c.requiresKey) {
    const key = await getApiKeyForPreset({ kind: "custom", name: c.name });
    if (!key) return false;
  }
  return c.baseUrl.trim().length > 0;
}
