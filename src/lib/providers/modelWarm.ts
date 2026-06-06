// ------------------------------------------------------------------
// Component: Model cache warmer
// Responsibility: Startup background discovery (#297). Enumerates every
//                 configured provider + openai_compat preset that has a
//                 usable key and triggers listModelInfos for each, which
//                 refreshes the persisted model cache (stale-while-
//                 revalidate). Fire-and-forget: never blocks boot, never
//                 throws. See ADR 013.
// Collaborators: providers/models (listModelInfos), providers/registry,
//                providers/openaiCompatStorage + presets, tauri/keychain.
// ------------------------------------------------------------------

import { ALL_PROVIDER_IDS, PROVIDER_REGISTRY } from "./registry";
import { BUILTIN_OPENAI_COMPAT_PRESETS } from "./openaiCompatPresets";
import { loadOpenAICompatConfig, getApiKeyForPreset } from "./openaiCompatStorage";
import { listModelInfos } from "./models";
import { keychain } from "../tauri/keychain";

// Refresh the model cache for every configured provider/preset. Each
// listModelInfos call updates the persisted cache so the next picker
// access is fresh; errors per provider are swallowed so one bad endpoint
// doesn't stop the rest. Returns once all refreshes settle.
export async function warmModelCaches(): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  // Native providers with a key (skip openai_compat — handled via presets
  // below — and keyless providers like mock).
  for (const provider of ALL_PROVIDER_IDS) {
    if (provider === "openai_compat" || provider === "mock") continue;
    const meta = PROVIDER_REGISTRY[provider];
    if (!meta.requiresKey) continue;
    jobs.push(
      (async () => {
        const key = await keychain.get(meta.keychainKey);
        if (key) await listModelInfos(provider, key);
      })().catch(() => {}),
    );
  }

  // Built-in openai_compat presets that have an API key configured.
  for (const preset of BUILTIN_OPENAI_COMPAT_PRESETS) {
    const ref = { kind: "builtin" as const, id: preset.id };
    jobs.push(
      (async () => {
        const key = await getApiKeyForPreset(ref);
        if (key) await listModelInfos("openai_compat", null, { openaiCompatPreset: ref });
      })().catch(() => {}),
    );
  }

  // Custom presets (may be keyless, e.g. local Ollama — always warm).
  const cfg = await loadOpenAICompatConfig();
  for (const custom of cfg.customs) {
    const ref = { kind: "custom" as const, name: custom.name };
    jobs.push(
      listModelInfos("openai_compat", null, { openaiCompatPreset: ref }).catch(() => {}),
    );
  }

  await Promise.allSettled(jobs);
}
