// ------------------------------------------------------------------
// Component: Conversation JSON-column schemas
// Responsibility: zod-backed parsers for the TEXT columns on the
//                 conversations table that hold JSON: visibility_matrix,
//                 autocompact_threshold, context_warnings_fired,
//                 selected_personas. Replaces the hand-written parsers
//                 that lived in persistence/conversations.ts (#165).
//                 Every parser soft-fails to a sane default so a single
//                 corrupt row never blocks listConversations().
// Collaborators: persistence/conversations.ts (consumer).
// ------------------------------------------------------------------

import { z } from "zod";
import type { AutocompactThreshold } from "../types";

const visibilityMatrixSchema = z.record(z.array(z.string()));

export function parseVisibilityMatrix(raw: string): Record<string, string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  // zod's record schema rejects whole-object on first invalid value;
  // we want to drop only the bad keys and keep the rest, matching the
  // existing repo behavior — so unwrap manually.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const valueResult = z.array(z.string()).safeParse(v);
    if (valueResult.success) out[k] = valueResult.data;
  }
  return visibilityMatrixSchema.parse(out);
}

const autocompactThresholdSchema = z
  .object({
    mode: z.enum(["kTokens", "percent"]),
    value: z.number().positive(),
    preserve: z.number().optional(),
  })
  .transform((v): AutocompactThreshold => {
    const result: AutocompactThreshold = { mode: v.mode, value: v.value };
    if (typeof v.preserve === "number" && v.preserve > 0) result.preserve = v.preserve;
    return result;
  });

export function parseAutocompactThreshold(raw: string | null): AutocompactThreshold | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = autocompactThresholdSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const numberArraySchema = z.array(z.unknown()).transform((arr) =>
  arr.filter((x): x is number => typeof x === "number"),
);

export function parseContextWarningsFired(raw: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = numberArraySchema.safeParse(parsed);
  return result.success ? result.data : [];
}

const stringArraySchema = z.array(z.unknown()).transform((arr) =>
  arr.filter((x): x is string => typeof x === "string"),
);

export function parseSelectedPersonas(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = stringArraySchema.safeParse(parsed);
  return result.success ? result.data : [];
}
