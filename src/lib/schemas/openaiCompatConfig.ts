// ------------------------------------------------------------------
// Component: OpenAI-compat config schema
// Responsibility: zod-backed parser for the persisted configuration
//                 blob (#140 → #169) holding per-built-in-preset
//                 templateVars + extraHeaders, plus the array of
//                 user-defined custom presets. Stored as a single
//                 JSON string under one settings key so the storage
//                 layer can load + save atomically.
// Collaborators: lib/providers/openaiCompatStorage (consumer),
//                lib/providers/openaiCompatPresets (preset id list).
// ------------------------------------------------------------------

import { z } from "zod";
import { BUILTIN_PRESET_IDS } from "../providers/openaiCompatPresets";

export interface BuiltinPresetConfig {
  templateVars: Record<string, string>;
  extraHeaders: Record<string, string>;
}

export interface CustomPresetConfig {
  name: string;
  baseUrl: string;
  extraHeaders: Record<string, string>;
  requiresKey: boolean;
  supportsUsageStream: boolean;
}

export interface OpenAICompatConfig {
  builtins: Record<string, BuiltinPresetConfig>;
  customs: CustomPresetConfig[];
}

export const EMPTY_OPENAI_COMPAT_CONFIG: Readonly<OpenAICompatConfig> = Object.freeze({
  builtins: Object.freeze({}) as Record<string, BuiltinPresetConfig>,
  customs: Object.freeze([]) as readonly CustomPresetConfig[] as CustomPresetConfig[],
});

const stringRecord = z.record(z.string());

const builtinPresetConfigSchema = z.object({
  templateVars: stringRecord.optional().default({}),
  extraHeaders: stringRecord.optional().default({}),
});

const customPresetConfigSchema = z
  .object({
    name: z.string().min(1),
    baseUrl: z.string().min(1),
    extraHeaders: stringRecord.optional().default({}),
    requiresKey: z.boolean().optional().default(true),
    supportsUsageStream: z.boolean().optional().default(true),
  })
  .transform(
    (v): CustomPresetConfig => ({
      name: v.name,
      baseUrl: v.baseUrl,
      extraHeaders: v.extraHeaders,
      requiresKey: v.requiresKey,
      supportsUsageStream: v.supportsUsageStream,
    }),
  );

const envelopeSchema = z.object({
  builtins: z.record(z.unknown()).optional().default({}),
  customs: z.array(z.unknown()).optional().default([]),
});

export function parseOpenAICompatConfig(raw: string | null): OpenAICompatConfig {
  if (raw === null || raw === "") return cloneEmpty();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cloneEmpty();
  }
  const top = envelopeSchema.safeParse(parsed);
  if (!top.success) return cloneEmpty();

  // Built-ins: filter to known preset ids and validate per entry.
  const builtins: Record<string, BuiltinPresetConfig> = {};
  for (const [id, entry] of Object.entries(top.data.builtins)) {
    if (!BUILTIN_PRESET_IDS.includes(id)) continue;
    const r = builtinPresetConfigSchema.safeParse(entry);
    if (r.success) builtins[id] = r.data;
  }

  // Customs: per-entry soft-fail. A single broken entry shouldn't
  // make the whole list disappear, matching the personasImport rule
  // (#165). Names must be unique; later entries lose to earlier ones.
  const seenNames = new Set<string>();
  const customs: CustomPresetConfig[] = [];
  for (const entry of top.data.customs) {
    const r = customPresetConfigSchema.safeParse(entry);
    if (!r.success) continue;
    if (seenNames.has(r.data.name)) continue;
    seenNames.add(r.data.name);
    customs.push(r.data);
  }

  return { builtins, customs };
}

function cloneEmpty(): OpenAICompatConfig {
  return { builtins: {}, customs: [] };
}
