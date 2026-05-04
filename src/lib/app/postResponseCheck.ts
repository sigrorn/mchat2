// ------------------------------------------------------------------
// Component: Post-response check (lib/app)
// Responsibility: After all responses complete, handle autocompact
//                 triggering and 80/90/98% context warnings.
//                 All checks are per-persona (#118): each persona is
//                 compared against ITS OWN model's max-context window.
//                 Originally lived in src/hooks/; moved here in #149
//                 with store calls routed through deps so the
//                 lib→stores boundary holds (#142).
// Collaborators: lib/commands/autocompactCheck, lib/conversations/
//                runCompaction, hooks/useSend (wires deps).
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
import { maxContextTokensForPersona } from "@/lib/providers/contextWindows";
import type { PostResponseCheckDeps } from "./deps";

/**
 * Build a per-persona usage record: current context tokens and that
 * persona's own provider max-context window.
 */
function computePersonaUsages(
  conversation: Conversation,
  personas: readonly Persona[],
  messages: readonly Message[],
  globalSystemPrompt: string | null,
  supersededIds: ReadonlySet<string>,
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
      supersededIds,
    });
    const systemCost = ctx.systemPrompt ? estimateTokens(ctx.systemPrompt) : 0;
    const messageCost = ctx.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    usages.push({
      persona: p,
      tokens: systemCost + messageCost,
      maxTokens: maxContextTokensForPersona(p),
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
export async function postResponseCheck(
  deps: PostResponseCheckDeps,
  conversationId: string,
): Promise<void> {
  const conversation = deps.getConversation(conversationId);
  if (!conversation) return;

  const personas = deps.getPersonas(conversationId);
  if (personas.length === 0) return;

  const messages = deps.getMessages(conversationId);
  const supersededIds = deps.getSupersededIds(conversationId);
  const globalPrompt = await deps.getGlobalSystemPrompt();

  const usages = computePersonaUsages(
    conversation,
    personas,
    [...messages],
    globalPrompt,
    supersededIds,
  );

  // Case 1: autocompact is on — check per-persona triggers.
  const triggers = autocompactTriggers(conversation, usages);
  if (triggers.length > 0) {
    const preserve = conversation.autocompactThreshold?.preserve ?? 0;
    await runAutocompact(deps, conversationId, conversation, personas, preserve);
    return;
  }

  // Case 2: autocompact is off — check warning thresholds (per-persona).
  const warnings = pendingWarnings(conversation, usages);
  if (warnings.length > 0) {
    const fired = [...(conversation.contextWarningsFired ?? []), ...warnings];
    await deps.setContextWarningsFired(conversationId, fired);
    const highest = warnings[warnings.length - 1]!;
    const triggering = personasAtThreshold(highest, usages);
    const names = formatTriggeringPersonas(triggering);
    await deps.appendNotice(
      conversationId,
      `⚠ ${names} — ${highest}% of own context window reached. Time for //compact ?`,
    );
  }
}

async function runAutocompact(
  deps: PostResponseCheckDeps,
  conversationId: string,
  conversation: Conversation,
  personas: readonly Persona[],
  preserve: number,
): Promise<void> {
  // #122 — emit current //stats before autocompact begins so the
  // pre-compaction TTFT/throughput averages are visible alongside the
  // post-compaction recap.
  const preMessages = deps.getMessages(conversationId);
  await deps.appendNotice(conversationId, formatStats(conversation, [...preMessages], personas));
  const result = await runCompaction(conversation, [...personas], preserve, {
    // #123 — use "compacting" status (pale brown) for the persona row
    // so autocompact is visually distinct from a regular response.
    onPersonaStart: (pid) => deps.setTargetStatus(conversationId, pid, "compacting"),
    onPersonaError: (pid) => deps.setTargetStatus(conversationId, pid, "retrying"),
    onPersonaDone: (pid) => deps.clearTargetStatus(conversationId, pid),
    onSlow: () => void deps.appendNotice(conversationId, "auto-compacting, please wait…"),
  });

  for (const f of result.failures) {
    await deps.appendNotice(
      conversationId,
      `autocompact: failed for ${f.persona.name}: ${f.error}`,
    );
  }
  if (result.nothingToDo) return;
  if (result.summaries.length === 0) {
    await deps.appendNotice(conversationId, "autocompact: no summaries generated.");
    return;
  }

  await deps.reloadMessages(conversationId);
  await deps.setCompactionFloor(conversationId, result.cutoff);
  // #240: previously also called deps.setLimit(conversationId, cutoff)
  // here so the visible-row limit mark followed the compaction floor.
  // limit_mark_index column dropped — the floor alone now bounds context.

  const lines = [
    `auto-compacted ${result.summaries.length} persona${result.summaries.length === 1 ? "" : "s"}.`,
  ];
  for (const s of result.summaries) {
    lines.push(formatPersonaLine(s, result.tightestMaxTokens));
  }
  await deps.appendNotice(conversationId, lines.join("\n"));
}
