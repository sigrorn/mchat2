// ------------------------------------------------------------------
// Component: Snapshot import
// Responsibility: Restore a conversation from a snapshot file. Creates
//                 conversation, personas, and messages with full ID
//                 remapping from names back to fresh IDs.
// Collaborators: snapshot.ts, snapshotFileOps.ts, Sidebar.tsx.
// ------------------------------------------------------------------

import type { Conversation, Persona, ProviderId } from "../types";
import type { SnapshotEnvelope } from "./snapshot";
import { createPersona, updatePersona } from "../personas/service";
import { slugify } from "../personas/slug";
import * as convRepo from "../persistence/conversations";
import * as messagesRepo from "../persistence/messages";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { keychain } from "../tauri/keychain";

export interface ImportResult {
  conversation: Conversation;
  personas: Persona[];
  missingKeys: string[];
}

export async function importSnapshot(snapshot: SnapshotEnvelope): Promise<ImportResult> {
  // 1. Create conversation.
  const conv = await convRepo.createConversation({
    title: snapshot.title,
    systemPrompt: snapshot.systemPrompt ?? null,
    displayMode: (snapshot.displayMode === "cols" ? "cols" : "lines") as "lines" | "cols",
    visibilityMode:
      (snapshot.visibilityMode === "joined" ? "joined" : "separated") as "separated" | "joined",
    visibilityMatrix: {},
    limitMarkIndex: snapshot.limitMarkIndex ?? null,
    limitSizeTokens: snapshot.limitSizeTokens ?? null,
    selectedPersonas: [],
    compactionFloorIndex: snapshot.compactionFloorIndex ?? null,
    lastProvider: null,
  });

  // 2. Create personas (two-pass for runsAfter).
  const nameToId = new Map<string, string>();
  const created: Persona[] = [];

  for (const sp of snapshot.personas) {
    const p = await createPersona({
      conversationId: conv.id,
      provider: sp.provider,
      name: sp.name,
      systemPromptOverride: sp.systemPromptOverride,
      modelOverride: sp.modelOverride,
      colorOverride: sp.colorOverride,
      apertusProductId: sp.apertusProductId,
      visibilityDefaults: sp.visibilityDefaults ?? {},
      currentMessageIndex: sp.createdAtMessageIndex,
      sortOrder: sp.sortOrder,
    });
    nameToId.set(sp.name.toLowerCase(), p.id);
    nameToId.set(slugify(sp.name), p.id);
    created.push(p);
  }

  // Patch runsAfter now that all IDs exist.
  for (let i = 0; i < snapshot.personas.length; i++) {
    const sp = snapshot.personas[i]!;
    if (!sp.runsAfter || sp.runsAfter.length === 0) continue;
    const parentIds = sp.runsAfter
      .map((name) => nameToId.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined);
    if (parentIds.length === 0) continue;
    const p = created[i]!;
    await updatePersona({ id: p.id, runsAfter: parentIds });
  }

  // 3. Resolve visibility matrix (names → IDs).
  const resolvedMatrix: Record<string, string[]> = {};
  for (const [observerName, sourceNames] of Object.entries(snapshot.visibilityMatrix)) {
    const observerId = nameToId.get(observerName.toLowerCase());
    if (!observerId) continue;
    resolvedMatrix[observerId] = sourceNames
      .map((n) => nameToId.get(n.toLowerCase()))
      .filter((id): id is string => id !== undefined);
  }

  // 4. Resolve selection (names → IDs).
  const selectedIds = (snapshot.selectedPersonas ?? [])
    .map((n) => nameToId.get(n.toLowerCase()))
    .filter((id): id is string => id !== undefined);

  // Update conversation with resolved matrix and selection.
  const updatedConv: Conversation = {
    ...conv,
    visibilityMatrix: resolvedMatrix,
    selectedPersonas: selectedIds,
  };
  await convRepo.updateConversation(updatedConv);

  // 5. Import messages with name → ID remapping.
  const resolveId = (name: string | null): string | null => {
    if (name === null) return null;
    return nameToId.get(name.toLowerCase()) ?? null;
  };
  const resolveIds = (names: string[]): string[] =>
    names.map((n) => nameToId.get(n.toLowerCase())).filter((id): id is string => id !== undefined);

  for (const sm of snapshot.messages) {
    await messagesRepo.appendMessage({
      conversationId: conv.id,
      role: sm.role as "user" | "assistant" | "system" | "notice",
      content: sm.content,
      provider: (sm.provider as ProviderId) ?? null,
      model: sm.model ?? null,
      personaId: resolveId(sm.persona),
      displayMode: sm.displayMode === "cols" ? "cols" : "lines",
      pinned: sm.pinned,
      pinTarget: resolveId(sm.pinTarget),
      addressedTo: resolveIds(sm.addressedTo),
      errorMessage: sm.errorMessage ?? null,
      errorTransient: sm.errorTransient,
      inputTokens: sm.inputTokens,
      outputTokens: sm.outputTokens,
      usageEstimated: sm.usageEstimated,
      audience: resolveIds(sm.audience),
    });
  }

  // 6. Validate API keys.
  const missingKeys: string[] = [];
  for (const p of created) {
    const reg = PROVIDER_REGISTRY[p.provider];
    if (reg.requiresKey) {
      const key = await keychain.get(reg.keychainKey);
      if (!key) missingKeys.push(p.name);
    }
  }

  return { conversation: updatedConv, personas: created, missingKeys };
}
