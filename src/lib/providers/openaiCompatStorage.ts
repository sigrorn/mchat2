// ------------------------------------------------------------------
// Component: OpenAI-compat config storage
// Responsibility: Load and save the openai_compat configuration blob
//                 (#140 → #169) and own per-preset CRUD helpers used
//                 by the dialog (#170) and the resolver (#169 phase A
//                 wiring). API keys live in the keychain under
//                 deterministic per-preset slot names; everything
//                 else (templateVars, extraHeaders, customs) lives
//                 in the settings table as one zod-validated JSON
//                 blob.
// Collaborators: lib/persistence/settings, lib/tauri/keychain,
//                lib/schemas/openaiCompatConfig.
// ------------------------------------------------------------------

import { getSetting, setSetting } from "../persistence/settings";
import { keychain } from "../tauri/keychain";
import {
  parseOpenAICompatConfig,
  type BuiltinPresetConfig,
  type CustomPresetConfig,
  type OpenAICompatConfig,
} from "../schemas/openaiCompatConfig";

const SETTINGS_KEY = "openai_compat.config";

export type PresetRef =
  | { kind: "builtin"; id: string }
  | { kind: "custom"; name: string };

export async function loadOpenAICompatConfig(): Promise<OpenAICompatConfig> {
  return parseOpenAICompatConfig(await getSetting(SETTINGS_KEY));
}

export async function saveOpenAICompatConfig(cfg: OpenAICompatConfig): Promise<void> {
  await setSetting(SETTINGS_KEY, JSON.stringify(cfg));
}

export async function setBuiltinPresetConfig(
  id: string,
  patch: BuiltinPresetConfig,
): Promise<void> {
  const cfg = await loadOpenAICompatConfig();
  cfg.builtins[id] = patch;
  await saveOpenAICompatConfig(cfg);
}

export async function upsertCustomPreset(entry: CustomPresetConfig): Promise<void> {
  const cfg = await loadOpenAICompatConfig();
  const idx = cfg.customs.findIndex((c) => c.name === entry.name);
  if (idx === -1) {
    cfg.customs = [...cfg.customs, entry];
  } else {
    cfg.customs = [
      ...cfg.customs.slice(0, idx),
      entry,
      ...cfg.customs.slice(idx + 1),
    ];
  }
  await saveOpenAICompatConfig(cfg);
}

export async function removeCustomPreset(name: string): Promise<void> {
  const cfg = await loadOpenAICompatConfig();
  cfg.customs = cfg.customs.filter((c) => c.name !== name);
  await saveOpenAICompatConfig(cfg);
  await removeApiKeyForPreset({ kind: "custom", name });
}

export async function renameCustomPreset(oldName: string, newName: string): Promise<void> {
  if (oldName === newName) return;
  const cfg = await loadOpenAICompatConfig();
  if (cfg.customs.some((c) => c.name === newName)) {
    throw new Error(`A custom preset named '${newName}' already exists`);
  }
  const target = cfg.customs.find((c) => c.name === oldName);
  if (!target) return;
  cfg.customs = cfg.customs.map((c) =>
    c.name === oldName ? { ...c, name: newName } : c,
  );
  await saveOpenAICompatConfig(cfg);

  // Move the keychain slot atomically — get-then-set under the new
  // slot, then remove the old. If the user had no key set, this is a
  // no-op.
  const existing = await getApiKeyForPreset({ kind: "custom", name: oldName });
  if (existing !== null) {
    await setApiKeyForPreset({ kind: "custom", name: newName }, existing);
    await removeApiKeyForPreset({ kind: "custom", name: oldName });
  }
}

export function apiKeySlotForPreset(ref: PresetRef): string {
  return ref.kind === "builtin"
    ? `openai_compat.${ref.id}.apiKey`
    : `openai_compat.custom.${ref.name}.apiKey`;
}

export async function getApiKeyForPreset(ref: PresetRef): Promise<string | null> {
  return keychain.get(apiKeySlotForPreset(ref));
}

export async function setApiKeyForPreset(ref: PresetRef, key: string): Promise<void> {
  await keychain.set(apiKeySlotForPreset(ref), key);
}

export async function removeApiKeyForPreset(ref: PresetRef): Promise<void> {
  await keychain.remove(apiKeySlotForPreset(ref));
}
