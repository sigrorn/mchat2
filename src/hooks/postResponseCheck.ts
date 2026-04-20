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
import { resolveAutocompactTokens, pendingWarnings, tightestPersonaNames } from "@/lib/commands/autocompactCheck";
import { generateCompactionSummary } from "@/lib/conversations/compact";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { modelForTarget } from "@/lib/orchestration/streamRunner";
import { resolveExtraConfig } from "@/lib/providers/extraConfig";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import * as messagesRepo from "@/lib/persistence/messages";
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

/**
 * Run the actual compaction (same logic as //compact in Composer).
 * Compactions run in parallel across all personas (ignoring runsAfter).
 */
async function runAutocompact(
  conversationId: string,
  conversation: Conversation,
  personas: readonly Persona[],
  currentTokens: number,
): Promise<void> {
  // Rough heuristic: >20k tokens likely takes >10s to summarize.
  if (currentTokens > 20000) {
    await useMessagesStore
      .getState()
      .appendNotice(conversationId, "auto-compacting, please wait…");
  }

  const history = useMessagesStore.getState().byConversation[conversationId] ?? [];
  const globalPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);

  type CompactResult =
    | { ok: true; persona: (typeof personas)[number]; summary: string; origTokens: number; summaryTokens: number; elapsedMs: number }
    | { ok: false; persona: (typeof personas)[number]; error: string };

  const results = await Promise.all(
    personas.map(async (p): Promise<CompactResult | null> => {
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
      if (ctx.messages.length === 0) return null;
      const origTokens =
        (ctx.systemPrompt ? estimateTokens(ctx.systemPrompt) : 0) +
        ctx.messages.reduce((s, m) => s + estimateTokens(m.content), 0);
      useSendStore.getState().setTargetStatus(conversationId, p.id, "streaming");
      const t0 = Date.now();
      try {
        const ak = PROVIDER_REGISTRY[p.provider].requiresKey
          ? await keychain.get(PROVIDER_REGISTRY[p.provider].keychainKey)
          : null;
        const model = modelForTarget(target, [...personas]);
        const extra = await resolveExtraConfig(p.provider, p);
        const summary = await generateCompactionSummary(
          adapterFor(p.provider),
          ak,
          model,
          ctx.messages,
          extra,
        );
        const elapsedMs = Date.now() - t0;
        if (!summary) return { ok: false, persona: p, error: "model returned empty summary" };
        const summaryTokens = estimateTokens(summary);
        return { ok: true, persona: p, summary, origTokens, summaryTokens, elapsedMs };
      } catch (e) {
        useSendStore.getState().setTargetStatus(conversationId, p.id, "retrying");
        return { ok: false, persona: p, error: (e as Error).message };
      } finally {
        useSendStore.getState().clearTargetStatus(conversationId, p.id);
      }
    }),
  );

  const summaries = results.filter(
    (r): r is Extract<CompactResult, { ok: true }> => r !== null && r.ok,
  );
  for (const r of results) {
    if (r && !r.ok) {
      await useMessagesStore
        .getState()
        .appendNotice(conversationId, `autocompact: failed for ${r.persona.name}: ${r.error}`);
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
  const lines = [`auto-compacted ${summaries.length} persona${summaries.length === 1 ? "" : "s"}.`];
  for (const s of summaries) {
    const origK = (s.origTokens / 1000).toFixed(1);
    const compK = (s.summaryTokens / 1000).toFixed(1);
    const pct = s.origTokens > 0 ? Math.round((1 - s.summaryTokens / s.origTokens) * 100) : 0;
    const sec = s.elapsedMs / 1000;
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(Math.floor(sec % 60)).padStart(2, "0");
    lines.push(`  ${s.persona.name}  ${origK}k → ${compK}k  −${pct}%  ${mm}:${ss}`);
  }
  await useMessagesStore.getState().appendNotice(conversationId, lines.join("\n"));
}
