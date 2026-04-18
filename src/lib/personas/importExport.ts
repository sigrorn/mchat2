// ------------------------------------------------------------------
// Component: Persona import/export
// Responsibility: Serialize the active personas of one conversation to
//                 a portable JSON document, and resolve such a document
//                 back into createPersona inputs for a target conversation.
//                 Pure — UI calls fs.saveDialog/openDialog around it.
// Collaborators: components/PersonaPanel.tsx (sole UI consumer).
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "../types";
import { ALL_PROVIDER_IDS } from "../providers/registry";

export const PERSONA_EXPORT_VERSION = 1;

// On-disk representation. Exported personas drop ids and conversation-
// scoped fields so the document is portable; runsAfter is by name.
export interface ExportedPersona {
  name: string;
  provider: ProviderId;
  systemPromptOverride: string | null;
  modelOverride: string | null;
  colorOverride: string | null;
  apertusProductId: string | null;
  visibilityDefaults: Record<string, "y" | "n">;
  runsAfter: string[]; // names of parent personas in this file
}

export interface ExportEnvelope {
  version: typeof PERSONA_EXPORT_VERSION;
  personas: ExportedPersona[];
}

export function serializePersonas(personas: readonly Persona[]): string {
  const live = personas.filter((p) => p.deletedAt === null);
  const nameById = new Map(live.map((p) => [p.id, p.name] as const));
  const out: ExportEnvelope = {
    version: PERSONA_EXPORT_VERSION,
    personas: live.map((p) => ({
      name: p.name,
      provider: p.provider,
      systemPromptOverride: p.systemPromptOverride,
      modelOverride: p.modelOverride,
      colorOverride: p.colorOverride,
      apertusProductId: p.apertusProductId,
      visibilityDefaults: p.visibilityDefaults,
      runsAfter: p.runsAfter
        .map((id) => nameById.get(id))
        .filter((n): n is string => n !== undefined),
    })),
  };
  return JSON.stringify(out, null, 2);
}

export type ParseResult = { ok: true; personas: ExportedPersona[] } | { ok: false; error: string };

export function parsePersonasImport(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "file is not valid JSON" };
  }
  if (!isObj(parsed)) return { ok: false, error: "expected an object at the top level" };
  if (parsed["version"] !== PERSONA_EXPORT_VERSION) {
    return { ok: false, error: `unsupported version: ${String(parsed["version"])}` };
  }
  const list = parsed["personas"];
  if (!Array.isArray(list)) return { ok: false, error: "personas must be an array" };
  const out: ExportedPersona[] = [];
  for (const entry of list) {
    if (!isObj(entry)) return { ok: false, error: "persona entry is not an object" };
    const name = entry["name"];
    const provider = entry["provider"];
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: "persona entry missing name" };
    }
    if (typeof provider !== "string" || !ALL_PROVIDER_IDS.includes(provider as ProviderId)) {
      return { ok: false, error: `persona '${name}' has unknown provider` };
    }
    out.push({
      name,
      provider: provider as ProviderId,
      systemPromptOverride: nullableString(entry["systemPromptOverride"]),
      modelOverride: nullableString(entry["modelOverride"]),
      colorOverride: nullableString(entry["colorOverride"]),
      apertusProductId: nullableString(entry["apertusProductId"]),
      visibilityDefaults: parseVisibilityDefaultsField(entry["visibilityDefaults"]),
      runsAfter: parseRunsAfterField(entry["runsAfter"]),
    });
  }
  return { ok: true, personas: out };
}

// Translates parsed import entries into the createPersona-shaped values
// the service needs, dropping name-collisions with existing active
// personas. runsAfter is resolved by name against the personas that
// will exist after the import (existing live + this batch).
export interface ResolvedImport {
  toCreate: Array<{
    name: string;
    provider: ProviderId;
    systemPromptOverride: string | null;
    modelOverride: string | null;
    colorOverride: string | null;
    apertusProductId: string | null;
    visibilityDefaults: Record<string, "y" | "n">;
    runsAfter: string[]; // resolved names
  }>;
  skipped: string[];
  visibilityWarnings: string[];
}

export function resolveImport(
  existing: readonly Persona[],
  imported: readonly ExportedPersona[],
): ResolvedImport {
  const existingNames = new Set(
    existing.filter((p) => p.deletedAt === null).map((p) => p.name.toLowerCase()),
  );
  const skipped: string[] = [];
  const accepted: ExportedPersona[] = [];
  for (const p of imported) {
    if (existingNames.has(p.name.toLowerCase())) {
      skipped.push(p.name);
    } else {
      accepted.push(p);
      existingNames.add(p.name.toLowerCase()); // dedupe within the batch too
    }
  }
  // Two-pass runsAfter resolution: we need ids, but the ids of accepted
  // personas don't exist yet. Caller will assign them. Surface runsAfter
  // as a *name* here and let the caller swap names→ids after createPersona.
  // Simpler: keep runsAfter as the source name; caller resolves.
  // For unresolved names, null them out now.
  const acceptedNames = new Set(accepted.map((p) => p.name.toLowerCase()));
  const existingLiveNames = new Set(
    existing.filter((p) => p.deletedAt === null).map((p) => p.name.toLowerCase()),
  );
  const known = new Set([...acceptedNames, ...existingLiveNames]);
  const visibilityWarnings: string[] = [];
  return {
    toCreate: accepted.map((p) => {
      const filtered: Record<string, "y" | "n"> = {};
      for (const [slug, val] of Object.entries(p.visibilityDefaults)) {
        if (known.has(slug.toLowerCase())) {
          filtered[slug] = val;
        } else {
          visibilityWarnings.push(`${p.name}: dropped unknown visibility reference '${slug}'`);
        }
      }
      return {
        name: p.name,
        provider: p.provider,
        systemPromptOverride: p.systemPromptOverride,
        modelOverride: p.modelOverride,
        colorOverride: p.colorOverride,
        apertusProductId: p.apertusProductId,
        visibilityDefaults: filtered,
        runsAfter: p.runsAfter.filter((n) => known.has(n.toLowerCase())),
      };
    }),
    skipped,
    visibilityWarnings,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRunsAfterField(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  if (typeof v === "string" && v !== "") return [v];
  return [];
}

function parseVisibilityDefaultsField(v: unknown): Record<string, "y" | "n"> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, "y" | "n"> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === "y" || val === "n") out[k] = val;
  }
  return out;
}

function nullableString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
