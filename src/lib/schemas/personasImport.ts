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
import type { ExportedPersona } from "../personas/importExport";
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
  })
  .transform((v): ExportedPersona => ({
    name: v.name,
    provider: v.provider as ProviderId,
    systemPromptOverride: nullableString(v.systemPromptOverride),
    modelOverride: nullableString(v.modelOverride),
    colorOverride: nullableString(v.colorOverride),
    apertusProductId: nullableString(v.apertusProductId),
    visibilityDefaults: parseVisibilityDefaultsField(v.visibilityDefaults),
    runsAfter: parseRunsAfterField(v.runsAfter),
  }));

const envelopeSchema = z.object({
  version: z.literal(PERSONA_EXPORT_VERSION),
  personas: z.array(z.unknown()),
});

export type ParseResult =
  | { ok: true; personas: ExportedPersona[]; skipped: string[] }
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
  return { ok: true, personas, skipped };
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
