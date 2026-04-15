// ------------------------------------------------------------------
// Component: Context builder
// Responsibility: Project the full message history down to the exact
//                 ChatMessage[] + systemPrompt a given persona should
//                 see at send time. All visibility rules live here so
//                 provider adapters and stores stay simple.
// Collaborators: orchestration/streamRunner.ts, providers/adapter.ts.
// ------------------------------------------------------------------

import type {
  Conversation,
  Message,
  Persona,
  PersonaTarget,
  ProviderId,
} from "../types";
import type { ChatMessage } from "../providers/adapter";

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
}

export interface BuildContextResult {
  systemPrompt: string | null;
  messages: ChatMessage[];
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
  const systemPrompt =
    globalPrompt && localPrompt
      ? `${globalPrompt}\n\n${localPrompt}`
      : (globalPrompt ?? localPrompt);
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

    if (m.role === "assistant" && conversation.visibilityMode === "separated") {
      if (m.audience.length > 0) {
        // Audience set present (issue #4): visibility is by audience
        // membership, not by authorship. Any co-addressee sees any
        // reply from within the same send group.
        if (!m.audience.includes(personaKey)) continue;
      } else if (messageKey(m) !== personaKey) {
        // Legacy row (pre-v3 or single-target send): author-only
        // filter. Preserves the old behavior for existing data.
        continue;
      }
    }

    if (!m.content) continue;
    out.push({ role: m.role, content: m.content });
  }

  return { systemPrompt, messages: out };
}

// Persona key convention used across the app: personaId, or provider id
// if no persona was attached (bare-provider send).
function messageKey(m: Message): string {
  if (m.personaId) return m.personaId;
  return (m.provider ?? "unknown") satisfies ProviderId | "unknown";
}
