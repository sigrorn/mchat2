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
import { truncateToFit, type SourceInfo } from "./truncate";
import { userNumberByIndex } from "../conversations/userMessageNumber";

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
  // The [N] user-message number of the first surviving non-pinned
  // message after truncation — for the notice text ("dropped messages
  // before #N"). null when no truncation happened.
  firstSurvivingUserNumber: number | null;
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

  // #73: DAG children in joined visibility may see sibling assistant
  // responses (from parents that completed earlier in this turn) after
  // the triggering user message. Providers like Mistral require the
  // last message to be 'user'. Detect this pattern (2+ trailing
  // assistants after the last user) and move the user message to the
  // end. A single trailing assistant is normal alternation and left
  // alone.
  if (out.length >= 3 && out[out.length - 1]!.role === "assistant") {
    let lastUserIdx = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const trailingAssistants = out.length - 1 - lastUserIdx;
    if (lastUserIdx >= 0 && trailingAssistants >= 2) {
      const [userMsg] = out.splice(lastUserIdx, 1);
      out.push(userMsg!);
    }
  }

  // #55: automatic context truncation. Build SourceInfo[] so the
  // turn-aware truncator knows which output rows are pinned and
  // carries user-message numbers for the notice text.
  // #64: limitSizeTokens narrows the budget further.
  const providerMax = input.maxContextTokens ?? Infinity;
  const convLimit = conversation.limitSizeTokens ?? Infinity;
  const maxTokens = Math.min(providerMax, convLimit);
  if (maxTokens && maxTokens !== Infinity) {
    const userNumbers = userNumberByIndex(messages);
    const sourceInfos: SourceInfo[] = [];
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
      sourceInfos.push({
        pinned: m.pinned,
        userNumber: m.role === "user" ? (userNumbers.get(m.index) ?? null) : null,
      });
    }
    const r = truncateToFit(systemPrompt, out, maxTokens, sourceInfos);
    return {
      systemPrompt,
      messages: r.messages,
      dropped: r.dropped,
      firstSurvivingUserNumber: r.firstSurvivingUserNumber,
    };
  }

  return { systemPrompt, messages: out, dropped: 0, firstSurvivingUserNumber: null };
}

// Persona key convention used across the app: personaId, or provider id
// if no persona was attached (bare-provider send).
function messageKey(m: Message): string {
  if (m.personaId) return m.personaId;
  return (m.provider ?? "unknown") satisfies ProviderId | "unknown";
}
