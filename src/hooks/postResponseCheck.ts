// ------------------------------------------------------------------
// Component: Post-response check
// Responsibility: After all responses complete, handle autocompact
//                 triggering and 80/90/98% context warnings.
// Collaborators: hooks/useSend.ts, lib/commands/autocompactCheck.ts,
//                lib/conversations/runCompaction.ts.
// ------------------------------------------------------------------

import type { Conversation, Persona, PersonaTarget } from "@/lib/types";
import { buildContext } from "@/lib/context";
import { estimateTokens } from "@/lib/context/truncate";
import {
  resolveAutocompactTokens,
  pendingWarnings,
  tightestPersonaNames,
} from "@/lib/commands/autocompactCheck";
import { runCompaction, formatPersonaLine } from "@/lib/conversations/runCompaction";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";

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
    const messageCost = ctx.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
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
  const conversation = useConversationsStore
    .getState()
    .conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  const personas = usePersonasStore.getState().byConversation[conversationId] ?? [];
  if (personas.length === 0) return;

  const messages = useMessagesStore.getState().byConversation[conversationId] ?? [];
  const globalPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);

  const currentTokens = estimateMaxContextTokens(conversation, personas, messages, globalPrompt);

  // Case 1: autocompact is on — check threshold.
  const threshold = resolveAutocompactTokens(conversation, personas);
  if (threshold !== null && currentTokens >= threshold) {
    const preserve = conversation.autocompactThreshold?.preserve ?? 0;
    await runAutocompact(conversationId, conversation, personas, preserve);
    return;
  }

  // Case 2: autocompact is off — check warning thresholds.
  const warnings = pendingWarnings(conversation, currentTokens, personas);
  if (warnings.length > 0) {
    const fired = [...(conversation.contextWarningsFired ?? []), ...warnings];
    await useConversationsStore.getState().setContextWarningsFired(conversationId, fired);
    const highest = warnings[warnings.length - 1]!;
    const names = tightestPersonaNames(personas);
    const forClause = names.length > 0 ? ` (for ${names.join(", ")})` : "";
    await useMessagesStore
      .getState()
      .appendNotice(
        conversationId,
        `⚠ ${highest}% context of tightest model reached${forClause} — time for //compact ?`,
      );
  }
}

async function runAutocompact(
  conversationId: string,
  conversation: Conversation,
  personas: readonly Persona[],
  preserve: number,
): Promise<void> {
  const result = await runCompaction(conversation, personas, preserve, {
    onPersonaStart: (pid) =>
      useSendStore.getState().setTargetStatus(conversationId, pid, "streaming"),
    onPersonaError: (pid) =>
      useSendStore.getState().setTargetStatus(conversationId, pid, "retrying"),
    onPersonaDone: (pid) => useSendStore.getState().clearTargetStatus(conversationId, pid),
    onSlow: () =>
      void useMessagesStore
        .getState()
        .appendNotice(conversationId, "auto-compacting, please wait…"),
  });

  for (const f of result.failures) {
    await useMessagesStore
      .getState()
      .appendNotice(conversationId, `autocompact: failed for ${f.persona.name}: ${f.error}`);
  }
  if (result.nothingToDo) return;
  if (result.summaries.length === 0) {
    await useMessagesStore
      .getState()
      .appendNotice(conversationId, "autocompact: no summaries generated.");
    return;
  }

  await useMessagesStore.getState().load(conversationId);
  await useConversationsStore.getState().setCompactionFloor(conversationId, result.cutoff);
  await useConversationsStore.getState().setLimit(conversationId, result.cutoff);

  const lines = [
    `auto-compacted ${result.summaries.length} persona${result.summaries.length === 1 ? "" : "s"}.`,
  ];
  for (const s of result.summaries) {
    lines.push(formatPersonaLine(s, result.tightestMaxTokens));
  }
  await useMessagesStore.getState().appendNotice(conversationId, lines.join("\n"));
}
