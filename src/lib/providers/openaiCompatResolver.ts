// ------------------------------------------------------------------
// Component: OpenAI-compat preset resolver
// Responsibility: Join a preset ref (built-in id or custom name)
//                 with the persisted config blob and the keychain
//                 into the resolved bag the openaiCompatTemplated
//                 adapter reads from extraConfig (#140 → #169).
//                 Phase A delivers this helper; phase C wires it
//                 into the per-target extraConfig pipeline once the
//                 persona schema gains a presetRef field.
// Collaborators: openaiCompatPresets (built-in defs),
//                openaiCompatStorage (persisted state + keychain),
//                openaiCompatTemplated (consumer at call time).
// ------------------------------------------------------------------

import {
  builtinPresetById,
  resolveTemplateUrl,
} from "./openaiCompatPresets";
import {
  loadOpenAICompatConfig,
  getApiKeyForPreset,
  type PresetRef,
} from "./openaiCompatStorage";

export interface ResolvedOpenAICompatConfig {
  url: string;
  extraHeaders: Record<string, string>;
  requiresKey: boolean;
  supportsUsageStream: boolean;
  apiKey: string | null;
  // ISO 3166 alpha-2 hosting country if known, else null. Used by
  // PersonaPanel to render `[CH] Infomaniak`-style tags. Custom
  // entries don't claim a country (we don't know where the user's
  // endpoint lives).
  hostingCountry: string | null;
}

export async function resolveOpenAICompatPreset(
  ref: PresetRef,
): Promise<ResolvedOpenAICompatConfig | null> {
  if (ref.kind === "builtin") {
    const def = builtinPresetById(ref.id);
    if (!def) return null;
    const cfg = await loadOpenAICompatConfig();
    const saved = cfg.builtins[ref.id];
    const url = resolveTemplateUrl(def.urlTemplate, saved?.templateVars ?? {});
    const apiKey = await getApiKeyForPreset(ref);
    return {
      url,
      extraHeaders: saved?.extraHeaders ?? {},
      requiresKey: def.requiresKey,
      supportsUsageStream: def.supportsUsageStream,
      apiKey,
      hostingCountry: def.hostingCountry,
    };
  }
  // Custom preset
  const cfg = await loadOpenAICompatConfig();
  const entry = cfg.customs.find((c) => c.name === ref.name);
  if (!entry) return null;
  const apiKey = await getApiKeyForPreset(ref);
  return {
    url: entry.baseUrl,
    extraHeaders: entry.extraHeaders,
    requiresKey: entry.requiresKey,
    supportsUsageStream: entry.supportsUsageStream,
    apiKey,
    hostingCountry: null,
  };
}
