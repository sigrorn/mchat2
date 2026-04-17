// ------------------------------------------------------------------
// Component: Context builder
// Responsibility: Project the full message history down to the exact
//                 ChatMessage[] + systemPrompt a given persona should
//                 see at send time. All visibility rules live here so
//                 provider adapters and stores stay simple.
// Collaborators: orchestration/streamRunner.ts, providers/adapter.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona, PersonaTarget, ProviderId } from "../types";
import type { ChatMessage } from "../providers/adapter";
import { truncateToFit } from "./truncate";

export interface BuildContextInput {
  conversation: Conversation;
  target: PersonaTarget;
  // Full message history for the conversation, in index order.
  messages: Message[];
  // Active personas for the conversation (tombstones excluded).
  personas: Persona[];
  // Optional app-wide system prompt prepended above the persona /
  // conversation tier (#23). Whitespace-only is treated as absent.
  globalSystemPrompt?: string | null;
  // Provider's token limit (#55). When set, oldest non-pinned messages
  // are dropped to fit. Infinity or omitted = no truncation.
  maxContextTokens?: number;
}

export interface BuildContextResult {
  systemPrompt: string | null;
  messages: ChatMessage[];
  // #55: number of messages dropped by context truncation (0 if none).
  dropped: number;
}

// The eight rules, applied in this order:
//
//  1. systemPrompt = persona.systemPromptOverride ?? conversation.systemPrompt
//  2. Exclude failed assistant rows (errorMessage !== null). A failed
//     retry must not poison the next attempt with its own error text.
//  3. Apply limitMarkIndex — drop messages with index < mark UNLESS
//     pinned (pinned rows always survive step 3).
//  4. Apply persona cutoff — drop messages with index <
//     persona.createdAtMessageIndex. Late-joining personas don't see
//     history they weren't present for.
//  5. Apply pinTarget — if a pinned row has pinTarget != null and !=
//     the current persona key, drop it.
//  6. Apply addressedTo — user rows with a non-empty addressedTo list
//     are only visible to the listed persona keys.
//  7. Apply visibilityMode ('separated') — drop assistant rows produced
//     by a different persona key. ('joined' keeps all assistant rows.)
//  8. Collapse to ChatMessage[] with roles 'user'/'assistant'; empty
//     content or role 'system' rows are dropped (system prompt is
//     attached separately in step 1).
export function buildContext(input: BuildContextInput): BuildContextResult {
  const { conversation, target, messages, personas } = input;
  const persona = target.personaId
    ? (personas.find((p) => p.id === target.personaId) ?? null)
    : null;

  const localPrompt = persona?.systemPromptOverride ?? conversation.systemPrompt;
  const globalPrompt = input.globalSystemPrompt?.trim() ? input.globalSystemPrompt.trim() : null;
  // #39: explicit persona identity goes in the system role, where the
  // modern LLMs actually honor it. Pinned user-row identity (#38) stays
  // as belt-and-suspenders. Bare-provider sends (no personaId) skip
  // this — there's no persona name to assert.
  const identityLine = persona
    ? `You are ${persona.name}. Only respond as yourself \u2014 do not include or generate responses for other personas.`
    : null;
  // Order matches old mchat: identity first (the persona's core), then
  // global preference, then local override. Tracing both apps with the
  // same persona setup confirmed Apertus only honors identity when the
  // 'You are X' line sits at the top of the system block.
  const systemPrompt =
    [identityLine, globalPrompt, localPrompt].filter((s): s is string => !!s).join("\n\n") || null;
  const personaKey = target.key;
  const limitMark = conversation.limitMarkIndex;
  const cutoff = persona?.createdAtMessageIndex ?? 0;

  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "notice") continue;
    if (m.role === "assistant" && m.errorMessage !== null) continue;

    if (limitMark !== null && m.index < limitMark && !m.pinned) continue;
    if (m.index < cutoff && !m.pinned) continue;

    if (m.pinned && m.pinTarget !== null && m.pinTarget !== personaKey) continue;

    if (m.role === "user" && m.addressedTo.length > 0 && !m.addressedTo.includes(personaKey)) {
      continue;
    }

    // #52: visibility matrix overrides the conversation-wide toggle for
    // observers present in the map. Observer missing from matrix → fall
    // through to the conversation-level separated/joined default.
    if (m.role === "assistant") {
      const matrixRow = conversation.visibilityMatrix[personaKey];
      if (matrixRow !== undefined) {
        // Matrix entry exists: observer sees self + listed sources.
        const sourceKey = messageKey(m);
        if (sourceKey !== personaKey && !matrixRow.includes(sourceKey)) continue;
      } else if (conversation.visibilityMode === "separated") {
        if (m.audience.length > 0) {
          if (!m.audience.includes(personaKey)) continue;
        } else if (messageKey(m) !== personaKey) {
          continue;
        }
      }
    }

    if (!m.content) continue;
    out.push({ role: m.role, content: m.content });
  }

  // #55: automatic context truncation. Track which output indices
  // came from pinned source messages so the truncator preserves them.
  const maxTokens = input.maxContextTokens;
  if (maxTokens && maxTokens !== Infinity) {
    const pinnedContentIndices = new Set<number>();
    let oi = 0;
    for (const m of messages) {
      if (m.role === "system" || m.role === "notice") continue;
      if (m.role === "assistant" && m.errorMessage !== null) continue;
      if (limitMark !== null && m.index < limitMark && !m.pinned) continue;
      if (m.index < cutoff && !m.pinned) continue;
      if (m.pinned && m.pinTarget !== null && m.pinTarget !== personaKey) continue;
      if (m.role === "user" && m.addressedTo.length > 0 && !m.addressedTo.includes(personaKey))
        continue;
      if (m.role === "assistant") {
        const matrixRow = conversation.visibilityMatrix[personaKey];
        if (matrixRow !== undefined) {
          const sourceKey = messageKey(m);
          if (sourceKey !== personaKey && !matrixRow.includes(sourceKey)) continue;
        } else if (conversation.visibilityMode === "separated") {
          if (m.audience.length > 0) {
            if (!m.audience.includes(personaKey)) continue;
          } else if (messageKey(m) !== personaKey) continue;
        }
      }
      if (!m.content) continue;
      if (m.pinned) pinnedContentIndices.add(oi);
      oi++;
    }
    const r = truncateToFit(systemPrompt, out, maxTokens, pinnedContentIndices);
    return { systemPrompt, messages: r.messages, dropped: r.dropped };
  }

  return { systemPrompt, messages: out, dropped: 0 };
}

// Persona key convention used across the app: personaId, or provider id
// if no persona was attached (bare-provider send).
function messageKey(m: Message): string {
  if (m.personaId) return m.personaId;
  return (m.provider ?? "unknown") satisfies ProviderId | "unknown";
}
