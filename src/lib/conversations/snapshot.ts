// ------------------------------------------------------------------
// Component: Conversation snapshot
// Responsibility: Serialize/deserialize full conversation state for
//                 export/import. All persona references use names
//                 (not IDs) for portability.
// Collaborators: fileOps, Sidebar (import button), context menu (export).
// ------------------------------------------------------------------

import type { Conversation, Flow, Message, Persona, ProviderId } from "../types";

export const SNAPSHOT_VERSION = 1;

export interface SnapshotPersona {
  name: string;
  provider: ProviderId;
  systemPromptOverride: string | null;
  modelOverride: string | null;
  colorOverride: string | null;
  apertusProductId: string | null;
  visibilityDefaults: Record<string, "y" | "n">;
  runsAfter: string[];
  sortOrder: number;
  createdAtMessageIndex: number;
  // #213: per-persona role lens, keyed by speaker *name* (not id) for
  // portability. The literal "user" key is preserved as-is. Optional
  // for back-compat with snapshots predating the role lens.
  roleLens?: Record<string, "user" | "assistant">;
}

export interface SnapshotMessage {
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  persona: string | null;
  displayMode: string;
  pinned: boolean;
  pinTarget: string | null;
  addressedTo: string[];
  audience: string[];
  index: number;
  createdAt: number;
  errorMessage: string | null;
  errorTransient: boolean;
  inputTokens: number;
  outputTokens: number;
  usageEstimated: boolean;
}

// #215: flow definition bundled when the conversation has one. Steps
// reference participating personas by name (not id) for portability.
export interface SnapshotFlowStep {
  kind: "user" | "personas";
  personas: string[];
}
export interface SnapshotFlow {
  currentStepIndex: number;
  steps: SnapshotFlowStep[];
}

export interface SnapshotEnvelope {
  version: typeof SNAPSHOT_VERSION;
  title: string;
  systemPrompt: string | null;
  displayMode: string;
  visibilityMode: string;
  visibilityMatrix: Record<string, string[]>;
  limitMarkIndex: number | null;
  limitSizeTokens: number | null;
  compactionFloorIndex: number | null;
  selectedPersonas: string[];
  personas: SnapshotPersona[];
  messages: SnapshotMessage[];
  // #215: optional. Absent = no flow attached (legacy or not yet
  // configured). Present = round-trips the editor's saved flow.
  flow?: SnapshotFlow;
}

// #213: lens entries are stored on disk keyed by speaker name (not id)
// for portability. The literal "user" key passes through unchanged.
// Persona-id keys that don't resolve to a live persona are dropped.
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

export interface SerializeSnapshotOptions {
  // #215: optional flow definition to bundle. If omitted, the
  // resulting snapshot has no `flow` field (back-compat with pre-#215
  // serialization).
  flow?: Flow | null;
}

export function serializeSnapshot(
  conversation: Conversation,
  personas: readonly Persona[],
  messages: readonly Message[],
  options?: SerializeSnapshotOptions,
): string {
  const live = personas.filter((p) => p.deletedAt === null);
  const idToName = new Map(live.map((p) => [p.id, p.name] as const));

  const resolveIds = (ids: string[]): string[] =>
    ids.map((id) => idToName.get(id) ?? id);

  const resolveId = (id: string | null): string | null =>
    id !== null ? (idToName.get(id) ?? id) : null;

  // Resolve visibility matrix keys (persona IDs) to names.
  const resolvedMatrix: Record<string, string[]> = {};
  for (const [observerId, sourceIds] of Object.entries(conversation.visibilityMatrix)) {
    const observerName = idToName.get(observerId);
    if (!observerName) continue;
    resolvedMatrix[observerName] = sourceIds
      .map((sid) => idToName.get(sid))
      .filter((n): n is string => n !== undefined);
  }

  const envelope: SnapshotEnvelope = {
    version: SNAPSHOT_VERSION,
    title: conversation.title,
    systemPrompt: conversation.systemPrompt,
    displayMode: conversation.displayMode,
    visibilityMode: conversation.visibilityMode,
    visibilityMatrix: resolvedMatrix,
    limitMarkIndex: conversation.limitMarkIndex,
    limitSizeTokens: conversation.limitSizeTokens,
    compactionFloorIndex: conversation.compactionFloorIndex,
    selectedPersonas: resolveIds(conversation.selectedPersonas),
    personas: live.map((p) => ({
      name: p.name,
      provider: p.provider,
      systemPromptOverride: p.systemPromptOverride,
      modelOverride: p.modelOverride,
      colorOverride: p.colorOverride,
      apertusProductId: p.apertusProductId,
      visibilityDefaults: p.visibilityDefaults,
      runsAfter: p.runsAfter
        .map((id) => idToName.get(id))
        .filter((n): n is string => n !== undefined),
      sortOrder: p.sortOrder,
      createdAtMessageIndex: p.createdAtMessageIndex,
      roleLens: serializeRoleLens(p.roleLens, idToName),
    })),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      provider: m.provider,
      model: m.model,
      persona: resolveId(m.personaId),
      displayMode: m.displayMode,
      pinned: m.pinned,
      pinTarget: resolveId(m.pinTarget),
      addressedTo: resolveIds(m.addressedTo),
      audience: resolveIds(m.audience),
      index: m.index,
      createdAt: m.createdAt,
      errorMessage: m.errorMessage,
      errorTransient: m.errorTransient,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      usageEstimated: m.usageEstimated,
    })),
  };

  // #215: bundle the flow when present. Steps reference participating
  // personas by name; ids that don't resolve (e.g. persona deleted but
  // step still references it) are dropped silently.
  if (options?.flow) {
    envelope.flow = {
      currentStepIndex: options.flow.currentStepIndex,
      steps: options.flow.steps.map((s) => ({
        kind: s.kind,
        personas: s.personaIds
          .map((id) => idToName.get(id))
          .filter((n): n is string => n !== undefined),
      })),
    };
  }

  return JSON.stringify(envelope, null, 2);
}

export async function compressSnapshot(json: string): Promise<Uint8Array> {
  const blob = new Blob([json]);
  const cs = new CompressionStream("gzip");
  const compressed = blob.stream().pipeThrough(cs);
  const reader = compressed.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function decompressSnapshot(data: Uint8Array): Promise<string> {
  const blob = new Blob([new Uint8Array(data)]);
  const ds = new DecompressionStream("gzip");
  const decompressed = blob.stream().pipeThrough(ds);
  const reader = decompressed.getReader();
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

// #165 — parsing routed through the zod-backed schema in lib/schemas/snapshot.
// The envelope shape is defined here; the parser lives next to the other
// trust-boundary schemas.
export { parseSnapshot, type ParseSnapshotResult } from "../schemas/snapshot";
