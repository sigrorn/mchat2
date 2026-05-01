// ------------------------------------------------------------------
// Component: Persona import schema
// Responsibility: zod-backed parser for persona import files (#165).
//                 Replaces the manual parsePersonasImport that lived
//                 in personas/importExport.ts. Top-level shape errors
//                 hard-fail (UI shows a clear "this isn't a persona
//                 file" message); per-entry validation soft-fails so
//                 a single bad persona doesn't sink the whole import.
// Collaborators: personas/importExport.ts (re-exports from here).
// ------------------------------------------------------------------

import { z } from "zod";
import type { ExportedFlow, ExportedPersona } from "../personas/importExport";
import { ALL_PROVIDER_IDS } from "../providers/registry";
import type { ProviderId } from "../types";

export const PERSONA_EXPORT_VERSION = 1;

// Loose entry — zod validates only the load-bearing fields. Optional
// fields fall back to [] / {} / null on the way out so the resolver
// downstream never sees `undefined`.
const importedPersonaSchema = z
  .object({
    name: z.string().min(1),
    provider: z.string().refine((v) => ALL_PROVIDER_IDS.includes(v as ProviderId)),
    systemPromptOverride: z.unknown().optional(),
    modelOverride: z.unknown().optional(),
    colorOverride: z.unknown().optional(),
    apertusProductId: z.unknown().optional(),
    visibilityDefaults: z.unknown().optional(),
    runsAfter: z.unknown().optional(),
    // #236: optional name-keyed role lens. Absent in pre-#236 envelopes.
    roleLens: z.unknown().optional(),
  })
  .transform((v): ExportedPersona => {
    const lens = parseRoleLensField(v.roleLens);
    return {
      name: v.name,
      provider: v.provider as ProviderId,
      systemPromptOverride: nullableString(v.systemPromptOverride),
      modelOverride: nullableString(v.modelOverride),
      colorOverride: nullableString(v.colorOverride),
      apertusProductId: nullableString(v.apertusProductId),
      visibilityDefaults: parseVisibilityDefaultsField(v.visibilityDefaults),
      runsAfter: parseRunsAfterField(v.runsAfter),
      ...(lens ? { roleLens: lens } : {}),
    };
  });

// #236: bundled flow definition. Loose schema — bad steps are dropped
// during the resolveImport remap rather than at parse time, matching
// the snapshot import's "tolerate gradual drift" stance.
const importedFlowStepSchema = z.object({
  kind: z.union([z.literal("user"), z.literal("personas")]),
  personas: z.array(z.string()),
  instruction: z.string().nullable().optional(),
});
const importedFlowSchema = z.object({
  currentStepIndex: z.number(),
  loopStartIndex: z.number().optional(),
  steps: z.array(importedFlowStepSchema),
});

const envelopeSchema = z.object({
  version: z.literal(PERSONA_EXPORT_VERSION),
  personas: z.array(z.unknown()),
  // #236: optional. Absent in pre-#236 envelopes.
  flow: importedFlowSchema.optional(),
});

export type ParseResult =
  | {
      ok: true;
      personas: ExportedPersona[];
      skipped: string[];
      // #236: bundled flow when present. Absent for pre-#236 envelopes.
      flow?: ExportedFlow;
    }
  | { ok: false; error: string };

export function parsePersonasImport(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "file is not valid JSON" };
  }
  const top = envelopeSchema.safeParse(parsed);
  if (!top.success) {
    // Distinguish version-mismatch from generic shape-error so the UI
    // can warn about old backups specifically.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as { version: unknown }).version !== PERSONA_EXPORT_VERSION
    ) {
      return {
        ok: false,
        error: `unsupported version: ${String((parsed as { version: unknown }).version)}`,
      };
    }
    return { ok: false, error: "expected an object with version and personas" };
  }
  const personas: ExportedPersona[] = [];
  const skipped: string[] = [];
  for (const entry of top.data.personas) {
    const result = importedPersonaSchema.safeParse(entry);
    if (result.success) {
      personas.push(result.data);
    } else {
      // Best-effort: name the bad row by whatever 'name' it had, falling
      // back to "<unnamed>" so the UI can list the drop count.
      const name =
        typeof entry === "object" && entry !== null && "name" in entry
          ? String((entry as { name: unknown }).name)
          : "<unnamed>";
      skipped.push(name);
    }
  }
  return {
    ok: true,
    personas,
    skipped,
    ...(top.data.flow ? { flow: top.data.flow as ExportedFlow } : {}),
  };
}

// #236: name-keyed map of "user" | "assistant" values. Returns null
// for absent / empty / malformed input so the persona's roleLens
// field stays undefined when there's nothing useful to carry.
function parseRoleLensField(
  v: unknown,
): Record<string, "user" | "assistant"> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, "user" | "assistant"> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === "user" || val === "assistant") out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function nullableString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
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
