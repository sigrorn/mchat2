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
import * as flowsRepo from "../persistence/flows";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { keychain } from "../tauri/keychain";
import { migrateRunsAfterToFlow } from "./migrateRunsAfterToFlow";

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
    autocompactThreshold: null,
    contextWarningsFired: [],
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

  // Patch runsAfter + roleLens now that all IDs exist.
  for (let i = 0; i < snapshot.personas.length; i++) {
    const sp = snapshot.personas[i]!;
    const p = created[i]!;
    const updates: { id: string; runsAfter?: string[]; roleLens?: Record<string, "user" | "assistant"> } = { id: p.id };
    if (sp.runsAfter && sp.runsAfter.length > 0) {
      const parentIds = sp.runsAfter
        .map((name) => nameToId.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);
      if (parentIds.length > 0) updates.runsAfter = parentIds;
    }
    if (sp.roleLens && Object.keys(sp.roleLens).length > 0) {
      // #213: lens entries are name-keyed on disk; remap to fresh ids.
      // The literal "user" passes through unchanged. Names that don't
      // resolve are dropped silently (the speaker simply isn't part of
      // the imported conversation any more).
      const remapped: Record<string, "user" | "assistant"> = {};
      for (const [key, value] of Object.entries(sp.roleLens)) {
        if (key === "user") {
          remapped.user = value;
        } else {
          const id = nameToId.get(key.toLowerCase());
          if (id) remapped[id] = value;
        }
      }
      if (Object.keys(remapped).length > 0) updates.roleLens = remapped;
    }
    if (updates.runsAfter !== undefined || updates.roleLens !== undefined) {
      await updatePersona(updates);
    }
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
      // #231: defaults to false when absent (legacy snapshots).
      flowDispatched: sm.flowDispatched ?? false,
    });
  }

  // 5b. Recreate the flow if bundled. Persona names are remapped to
  // freshly-assigned ids; names that don't resolve are dropped.
  if (snapshot.flow) {
    const remappedSteps = snapshot.flow.steps.map((s) => ({
      kind: s.kind,
      personaIds: s.personas
        .map((n) => nameToId.get(n.toLowerCase()))
        .filter((id): id is string => id !== undefined),
      // #230: carry the per-step instruction across import. flowsRepo
      // normalises empty/whitespace to null on store.
      instruction: s.instruction ?? null,
    }));
    // Defensive: if a `personas` step lost all members in remap, drop
    // the step rather than trip the empty-personas validation.
    const cleaned = remappedSteps.filter(
      (s) => !(s.kind === "personas" && s.personaIds.length === 0),
    );
    if (cleaned.length > 0) {
      // #220: bound loopStartIndex to the cleaned step count. If a
      // remap dropped enough steps to push the saved value past the
      // new array bounds, fall back to 0 — better than tripping the
      // upsert's validation.
      const rawLoopStart = snapshot.flow.loopStartIndex ?? 0;
      const safeLoopStart =
        rawLoopStart >= 0 && rawLoopStart < cleaned.length ? rawLoopStart : 0;
      await flowsRepo.upsertFlow(conv.id, {
        currentStepIndex: snapshot.flow.currentStepIndex,
        loopStartIndex: safeLoopStart,
        steps: cleaned,
      });
    }
  }

  // 5c. #241 Phase 0 / Trigger B: legacy snapshots that carry
  // runs_after but no bundled flow auto-derive one at import time.
  // Skipped silently when the snapshot already had a flow attached
  // (handled in 5b above) — migrateRunsAfterToFlow respects the
  // existing flow and just clears runsAfter to keep state coherent.
  const importedHadRunsAfter = snapshot.personas.some(
    (sp) => Array.isArray(sp.runsAfter) && sp.runsAfter.length > 0,
  );
  if (importedHadRunsAfter) {
    await migrateRunsAfterToFlow(conv.id, { trigger: "import" });
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
