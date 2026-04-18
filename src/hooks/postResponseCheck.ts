// ------------------------------------------------------------------
// Component: Post-response check
// Responsibility: After all persona responses finish, check whether
//                 autocompact should trigger or context warnings should
//                 be emitted.
// Collaborators: hooks/useSend.ts, lib/commands/autocompactCheck.ts,
//                stores/conversationsStore, stores/messagesStore.
// ------------------------------------------------------------------

import type { Conversation, Persona, PersonaTarget } from "@/lib/types";
import { buildContext } from "@/lib/context";
import { estimateTokens } from "@/lib/context/truncate";
import { resolveAutocompactTokens, pendingWarnings } from "@/lib/commands/autocompactCheck";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { usePersonasStore } from "@/stores/personasStore";

/**
 * Estimate the current max context token count across all personas.
 * Uses the tightest (largest) context footprint among personas.
 */
function estimateMaxContextTokens(
  conversation: Conversation,
  personas: readonly Persona[],
  messages: readonly import("@/lib/types").Message[],
  globalSystemPrompt: string | null,
): number {
  let maxTokens = 0;
  for (const p of personas) {
    const target: PersonaTarget = {
      provider: p.provider,
      personaId: p.id,
      key: p.id,
      displayName: p.name,
    };
    const ctx = buildContext({
      conversation,
      target,
      messages: [...messages],
      personas: [...personas],
      globalSystemPrompt,
    });
    const systemCost = ctx.systemPrompt ? estimateTokens(ctx.systemPrompt) : 0;
    const messageCost = ctx.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );
    const total = systemCost + messageCost;
    if (total > maxTokens) maxTokens = total;
  }
  return maxTokens;
}

/**
 * Run after all responses complete. Handles autocompact triggering
 * and 80/90/98% context warnings.
 */
export async function postResponseCheck(conversationId: string): Promise<void> {
  // Re-read current conversation state (may have been updated during send).
  const conversation = useConversationsStore
    .getState()
    .conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  const personas = usePersonasStore.getState().byConversation[conversationId] ?? [];
  if (personas.length === 0) return;

  const messages = useMessagesStore.getState().byConversation[conversationId] ?? [];
  const { getSetting } = await import("@/lib/persistence/settings");
  const { GLOBAL_SYSTEM_PROMPT_KEY } = await import("@/lib/settings/keys");
  const globalPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);

  const currentTokens = estimateMaxContextTokens(
    conversation,
    personas,
    messages,
    globalPrompt,
  );

  // Case 1: autocompact is on — check threshold.
  const threshold = resolveAutocompactTokens(conversation, personas);
  if (threshold !== null && currentTokens >= threshold) {
    await runAutocompact(conversationId, conversation, personas, currentTokens);
    return;
  }

  // Case 2: autocompact is off — check warning thresholds.
  const warnings = pendingWarnings(conversation, currentTokens, personas);
  if (warnings.length > 0) {
    const fired = [...(conversation.contextWarningsFired ?? []), ...warnings];
    await useConversationsStore.getState().setContextWarningsFired(conversationId, fired);
    const highest = warnings[warnings.length - 1]!;
    await useMessagesStore
      .getState()
      .appendNotice(
        conversationId,
        `⚠ ${highest}% context of tightest model reached — time for //compact ?`,
      );
  }
}

/**
 * Run the actual compaction (same logic as //compact in Composer).
 */
async function runAutocompact(
  conversationId: string,
  conversation: Conversation,
  personas: readonly Persona[],
  currentTokens: number,
): Promise<void> {
  const { buildContext } = await import("@/lib/context");
  const { generateCompactionSummary } = await import("@/lib/conversations/compact");
  const { adapterFor } = await import("@/lib/providers/registryOfAdapters");
  const { PROVIDER_REGISTRY } = await import("@/lib/providers/registry");
  const { modelForTarget } = await import("@/lib/orchestration/streamRunner");
  const { keychain } = await import("@/lib/tauri/keychain");
  const { getSetting } = await import("@/lib/persistence/settings");
  const { GLOBAL_SYSTEM_PROMPT_KEY } = await import("@/lib/settings/keys");

  // Rough heuristic: >20k tokens likely takes >10s to summarize.
  if (currentTokens > 20000) {
    await useMessagesStore
      .getState()
      .appendNotice(conversationId, "auto-compacting, please wait…");
  }

  const history = useMessagesStore.getState().byConversation[conversationId] ?? [];
  const globalPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);

  const summaries: Array<{ persona: (typeof personas)[number]; summary: string }> = [];
  for (const p of personas) {
    const target = {
      provider: p.provider,
      personaId: p.id,
      key: p.id,
      displayName: p.name,
    };
    const ctx = buildContext({
      conversation,
      target,
      messages: [...history],
      personas: [...personas],
      globalSystemPrompt: globalPrompt,
    });
    if (ctx.messages.length === 0) continue;
    try {
      const ak = PROVIDER_REGISTRY[p.provider].requiresKey
        ? await keychain.get(PROVIDER_REGISTRY[p.provider].keychainKey)
        : null;
      const model = modelForTarget(target, [...personas]);
      const summary = await generateCompactionSummary(
        adapterFor(p.provider),
        ak,
        model,
        ctx.messages,
      );
      if (summary) summaries.push({ persona: p, summary });
    } catch (e) {
      await useMessagesStore
        .getState()
        .appendNotice(
          conversationId,
          `autocompact: failed for ${p.name}: ${(e as Error).message}`,
        );
    }
  }

  if (summaries.length === 0) {
    await useMessagesStore
      .getState()
      .appendNotice(conversationId, "autocompact: no summaries generated.");
    return;
  }

  // Insert COMPACTION notice + per-persona summaries.
  await useMessagesStore.getState().appendNotice(conversationId, "COMPACTION");
  const messagesRepo = await import("@/lib/persistence/messages");
  for (const { persona: p, summary } of summaries) {
    await messagesRepo.appendMessage({
      conversationId,
      role: "assistant",
      content: `[compacted summary]\n\n${summary}`,
      provider: p.provider,
      model: p.modelOverride ?? PROVIDER_REGISTRY[p.provider].defaultModel,
      personaId: p.id,
      displayMode: "lines",
      pinned: true,
      pinTarget: p.id,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
  }
  await useMessagesStore.getState().load(conversationId);

  // Set the compaction floor.
  const freshHistory = useMessagesStore.getState().byConversation[conversationId] ?? [];
  const compactionNotice = [...freshHistory]
    .reverse()
    .find((m) => m.role === "notice" && m.content === "COMPACTION");
  if (compactionNotice) {
    await useConversationsStore
      .getState()
      .setCompactionFloor(conversationId, compactionNotice.index);
    await useConversationsStore
      .getState()
      .setLimit(conversationId, compactionNotice.index);
  }
  await useMessagesStore
    .getState()
    .appendNotice(
      conversationId,
      `auto-compacted ${summaries.length} persona${summaries.length === 1 ? "" : "s"}.`,
    );
}
