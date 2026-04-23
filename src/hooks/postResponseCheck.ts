// ------------------------------------------------------------------
// Component: Post-response check
// Responsibility: After all responses complete, handle autocompact
//                 triggering and 80/90/98% context warnings.
//                 All checks are per-persona (#118): each persona is
//                 compared against ITS OWN model's max-context window.
// Collaborators: hooks/useSend.ts, lib/commands/autocompactCheck.ts,
//                lib/conversations/runCompaction.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona, PersonaTarget } from "@/lib/types";
import { buildContext } from "@/lib/context";
import { estimateTokens } from "@/lib/context/truncate";
import {
  pendingWarnings,
  personasAtThreshold,
  autocompactTriggers,
  type PersonaUsage,
} from "@/lib/commands/autocompactCheck";
import { runCompaction, formatPersonaLine } from "@/lib/conversations/runCompaction";
import { formatStats } from "@/lib/commands/stats";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";

/**
 * Build a per-persona usage record: current context tokens and that
 * persona's own provider max-context window.
 */
function computePersonaUsages(
  conversation: Conversation,
  personas: readonly Persona[],
  messages: readonly Message[],
  globalSystemPrompt: string | null,
): PersonaUsage[] {
  const usages: PersonaUsage[] = [];
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
    usages.push({
      persona: p,
      tokens: systemCost + messageCost,
      maxTokens: PROVIDER_REGISTRY[p.provider].maxContextTokens,
    });
  }
  return usages;
}

/**
 * Format the list of personas triggering a warning as "albert at 85%,
 * gemma at 82%" — using each persona's own ratio, not a shared one.
 */
function formatTriggeringPersonas(personas: readonly PersonaUsage[]): string {
  return personas
    .map((u) => {
      const pct =
        Number.isFinite(u.maxTokens) && u.maxTokens > 0
          ? Math.round((u.tokens / u.maxTokens) * 100)
          : 0;
      return `${u.persona.name} at ${pct}%`;
    })
    .join(", ");
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

  const usages = computePersonaUsages(conversation, personas, messages, globalPrompt);

  // Case 1: autocompact is on — check per-persona triggers.
  const triggers = autocompactTriggers(conversation, usages);
  if (triggers.length > 0) {
    const preserve = conversation.autocompactThreshold?.preserve ?? 0;
    await runAutocompact(conversationId, conversation, personas, preserve);
    return;
  }

  // Case 2: autocompact is off — check warning thresholds (per-persona).
  const warnings = pendingWarnings(conversation, usages);
  if (warnings.length > 0) {
    const fired = [...(conversation.contextWarningsFired ?? []), ...warnings];
    await useConversationsStore.getState().setContextWarningsFired(conversationId, fired);
    const highest = warnings[warnings.length - 1]!;
    const triggering = personasAtThreshold(highest, usages);
    const names = formatTriggeringPersonas(triggering);
    await useMessagesStore
      .getState()
      .appendNotice(
        conversationId,
        `⚠ ${names} — ${highest}% of own context window reached. Time for //compact ?`,
      );
  }
}

async function runAutocompact(
  conversationId: string,
  conversation: Conversation,
  personas: readonly Persona[],
  preserve: number,
): Promise<void> {
  // #122 — emit current //stats before autocompact begins so the
  // pre-compaction TTFT/throughput averages are visible alongside the
  // post-compaction recap.
  const preMessages = useMessagesStore.getState().byConversation[conversationId] ?? [];
  await useMessagesStore
    .getState()
    .appendNotice(conversationId, formatStats(conversation, preMessages, personas));
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
