// ------------------------------------------------------------------
// Component: Snapshot envelope schema
// Responsibility: zod-backed parser for the SnapshotEnvelope produced
//                 by serializeSnapshot (#165). Replaces the hand-written
//                 parseSnapshot. Top-level errors hard-fail with a
//                 clear error string so a malformed backup file shows
//                 a meaningful message instead of corrupting the
//                 import flow.
// Collaborators: conversations/snapshot.ts (re-exports from here).
// ------------------------------------------------------------------

import { z } from "zod";
import type { SnapshotEnvelope } from "../conversations/snapshot";

export const SNAPSHOT_VERSION = 1;

const personaSchema = z.object({
  name: z.string(),
  provider: z.string(),
  systemPromptOverride: z.string().nullable(),
  modelOverride: z.string().nullable(),
  colorOverride: z.string().nullable(),
  apertusProductId: z.string().nullable(),
  visibilityDefaults: z.record(z.union([z.literal("y"), z.literal("n")])),
  runsAfter: z.array(z.string()),
  sortOrder: z.number(),
  createdAtMessageIndex: z.number(),
  // #213: optional for back-compat with pre-#213 snapshots.
  roleLens: z
    .record(z.union([z.literal("user"), z.literal("assistant")]))
    .optional(),
});

const messageSchema = z.object({
  role: z.string(),
  content: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  persona: z.string().nullable(),
  displayMode: z.string(),
  pinned: z.boolean(),
  pinTarget: z.string().nullable(),
  addressedTo: z.array(z.string()),
  audience: z.array(z.string()),
  index: z.number(),
  createdAt: z.number(),
  errorMessage: z.string().nullable(),
  errorTransient: z.boolean(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  usageEstimated: z.boolean(),
});

// #215: flow definition. Optional so legacy snapshots parse cleanly.
const flowStepSchema = z.object({
  kind: z.union([z.literal("user"), z.literal("personas")]),
  personas: z.array(z.string()),
});
const flowSchema = z.object({
  currentStepIndex: z.number(),
  steps: z.array(flowStepSchema),
});

const envelopeSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  title: z.string(),
  systemPrompt: z.string().nullable(),
  displayMode: z.string(),
  visibilityMode: z.string(),
  visibilityMatrix: z.record(z.array(z.string())),
  limitMarkIndex: z.number().nullable(),
  limitSizeTokens: z.number().nullable(),
  compactionFloorIndex: z.number().nullable(),
  selectedPersonas: z.array(z.string()),
  personas: z.array(personaSchema),
  messages: z.array(messageSchema),
  flow: flowSchema.optional(),
});

export type ParseSnapshotResult =
  | { ok: true; snapshot: SnapshotEnvelope }
  | { ok: false; error: string };

export function parseSnapshot(json: string): ParseSnapshotResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "expected an object" };
  }
  const versionRaw = (parsed as { version?: unknown }).version;
  if (versionRaw !== SNAPSHOT_VERSION) {
    return { ok: false, error: `unsupported version: ${String(versionRaw)}` };
  }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "<root>";
    return { ok: false, error: `invalid snapshot at ${path}: ${issue?.message ?? "unknown"}` };
  }
  return { ok: true, snapshot: result.data as SnapshotEnvelope };
}
