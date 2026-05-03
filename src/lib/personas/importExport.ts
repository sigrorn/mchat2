// ------------------------------------------------------------------
// Component: Persona import/export
// Responsibility: Serialize the active personas of one conversation to
//                 a portable JSON document, and resolve such a document
//                 back into createPersona inputs for a target conversation.
//                 Pure — UI calls fs.saveDialog/openDialog around it.
// Collaborators: components/PersonaPanel.tsx (sole UI consumer).
// ------------------------------------------------------------------

import type { Flow, Persona, ProviderId } from "../types";

export const PERSONA_EXPORT_VERSION = 1;

// #236: bundled flow definition. Mirrors SnapshotFlow's shape — steps
// reference participating personas by *name* for portability. Optional
// throughout for back-compat with pre-#236 export files.
export interface ExportedFlowStep {
  kind: "user" | "personas";
  personas: string[];
  instruction?: string | null;
}
export interface ExportedFlow {
  currentStepIndex: number;
  loopStartIndex?: number;
  steps: ExportedFlowStep[];
}

// On-disk representation. Exported personas drop ids and conversation-
// scoped fields so the document is portable. #241 Phase C dropped the
// runs_after field from disk; the type leaves it as optional purely so
// legacy envelopes round-trip — modern exports never emit it.
export interface ExportedPersona {
  name: string;
  provider: ProviderId;
  systemPromptOverride: string | null;
  modelOverride: string | null;
  colorOverride: string | null;
  // #258 Phase C: optional only — modern exports omit it. Kept on
  // the type so legacy envelopes round-trip through parse → resolve.
  apertusProductId?: string | null;
  visibilityDefaults: Record<string, "y" | "n">;
  runsAfter?: string[];
  // #236: per-persona role lens, keyed by speaker *name* (not id).
  // Literal 'user' key passes through unchanged. Optional for
  // back-compat with pre-#236 envelopes.
  roleLens?: Record<string, "user" | "assistant">;
}

export interface ExportEnvelope {
  version: typeof PERSONA_EXPORT_VERSION;
  personas: ExportedPersona[];
  // #236: optional bundled flow. Absent in pre-#236 envelopes.
  flow?: ExportedFlow;
}

export interface SerializePersonasOptions {
  // #236: optional flow to bundle. When absent, the resulting envelope
  // has no `flow` field — preserves byte-identity with pre-#236 exports.
  flow?: Flow | null;
}

// #236: name-keyed lens (literal 'user' passes through; persona-id keys
// remap to names; ids that don't resolve to a live persona are dropped).
function serializeRoleLens(
  lens: Record<string, "user" | "assistant">,
  idToName: ReadonlyMap<string, string>,
): Record<string, "user" | "assistant"> {
  const out: Record<string, "user" | "assistant"> = {};
  for (const [key, value] of Object.entries(lens)) {
    if (key === "user") {
      out.user = value;
    } else {
      const name = idToName.get(key);
      if (name) out[name] = value;
    }
  }
  return out;
}

export function serializePersonas(
  personas: readonly Persona[],
  options?: SerializePersonasOptions,
): string {
  const live = personas.filter((p) => p.deletedAt === null);
  const nameById = new Map(live.map((p) => [p.id, p.name] as const));
  const out: ExportEnvelope = {
    version: PERSONA_EXPORT_VERSION,
    personas: live.map((p) => {
      const lens = serializeRoleLens(p.roleLens, nameById);
      return {
        name: p.name,
        provider: p.provider,
        systemPromptOverride: p.systemPromptOverride,
        modelOverride: p.modelOverride,
        colorOverride: p.colorOverride,
        // #258 Phase C: apertusProductId field gone from Persona;
        // modern exports don't emit it.
        visibilityDefaults: p.visibilityDefaults,
        // #236: emit only when non-empty so legacy-shaped exports stay
        // byte-for-byte identical. Imports treat absent + {} the same.
        ...(Object.keys(lens).length > 0 ? { roleLens: lens } : {}),
      };
    }),
  };
  if (options?.flow) {
    out.flow = {
      currentStepIndex: options.flow.currentStepIndex,
      loopStartIndex: options.flow.loopStartIndex,
      steps: options.flow.steps.map((s) => ({
        kind: s.kind,
        personas: s.personaIds
          .map((id) => nameById.get(id))
          .filter((n): n is string => n !== undefined),
        ...(s.instruction ? { instruction: s.instruction } : {}),
      })),
    };
  }
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
    // #258 Phase C: surfaced from legacy envelopes only; modern
    // imports never carry this. fileOps writes it to the openai_compat
    // infomaniak preset's PRODUCT_ID template var when present.
    apertusProductId?: string | null;
    visibilityDefaults: Record<string, "y" | "n">;
    runsAfter: string[]; // resolved names
    // #236: name-keyed role lens carried verbatim from the envelope
    // so fileOps can remap to fresh ids after createPersona returns.
    roleLens?: Record<string, "user" | "assistant">;
  }>;
  skipped: string[];
  visibilityWarnings: string[];
  // #236: optional bundled flow, threaded through unchanged so the
  // file-ops layer can recreate it against the freshly-assigned ids.
  flow?: ExportedFlow;
}

export function resolveImport(
  existing: readonly Persona[],
  imported: readonly ExportedPersona[],
  flow?: ExportedFlow,
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
      // #241 Phase C: legacy runs_after edges no longer round-trip
      // through Persona on disk. We still parse and keep the names of
      // resolvable parents so fileOps can hand them to
      // migrateRunsAfterToFlow as a transient map for legacy imports.
      const declaredRunsAfter = (p.runsAfter ?? []).filter((n) =>
        known.has(n.toLowerCase()),
      );
      return {
        name: p.name,
        provider: p.provider,
        systemPromptOverride: p.systemPromptOverride,
        modelOverride: p.modelOverride,
        colorOverride: p.colorOverride,
        // #258 Phase C: legacy envelopes may still include this field;
        // pass it through (typed as optional) so fileOps can write it
        // to the global openai_compat infomaniak config when present.
        ...(p.apertusProductId !== undefined && p.apertusProductId !== null
          ? { apertusProductId: p.apertusProductId }
          : {}),
        visibilityDefaults: filtered,
        runsAfter: declaredRunsAfter,
        // #236: carry roleLens verbatim — fileOps remaps the
        // name keys to ids after createPersona assigns them.
        ...(p.roleLens && Object.keys(p.roleLens).length > 0
          ? { roleLens: p.roleLens }
          : {}),
      };
    }),
    skipped,
    visibilityWarnings,
    // #236: thread the bundled flow through unchanged.
    ...(flow ? { flow } : {}),
  };
}

