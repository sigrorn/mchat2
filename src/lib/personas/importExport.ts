// ------------------------------------------------------------------
// Component: Persona import/export
// Responsibility: Serialize the active personas of one conversation to
//                 a portable JSON document, and resolve such a document
//                 back into createPersona inputs for a target conversation.
//                 Pure — UI calls fs.saveDialog/openDialog around it.
// Collaborators: components/PersonaPanel.tsx (sole UI consumer).
// ------------------------------------------------------------------

import type { Persona, ProviderId } from "../types";

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

// #165 — parsing routed through the zod-backed schema in lib/schemas/.
// Per-entry validation now soft-fails (drops bad personas, keeps the
// rest); the previous parser hard-failed on the first bad entry. The
// types stay assignment-compatible so callers don't change.
export { parsePersonasImport, type ParseResult } from "../schemas/personasImport";

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

