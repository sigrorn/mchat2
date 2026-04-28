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
  // #180: ids of assistant rows whose Attempt has been superseded by a
  // later one (e.g. retry/replay survivors). Filtered out so a fresh
  // run doesn't see the stale reply alongside the surviving one.
  // Optional — callers that don't carry this state pass undefined and
  // get the legacy "exclude only by errorMessage" behavior.
  supersededIds?: ReadonlySet<string>;
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

// #213: intermediate shape unifying the role-projected message + the
// per-row metadata the truncator needs. Lens application, normalization
// and the trailing-user shuffle all transform ProjectedEntry[] in
// lockstep so the parallel ChatMessage[] + SourceInfo[] arrays can't
// drift out of sync the way they used to.
interface ProjectedEntry {
  role: "user" | "assistant";
  content: string;
  // Source persona-id or the literal "user". Becomes "merged" after
  // normalization collapses adjacent same-role entries.
  speakerKey: string;
  sourceInfo: SourceInfo;
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
//  8. Project to ProjectedEntry[]: apply persona.roleLens (#213), then
//     prefix other personas' content with "<name>: ", then collapse
//     adjacent same-role entries (Anthropic 400s on consecutive
//     same-role messages).
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
    ? `You are ${persona.name}. Only respond as yourself — do not include or generate responses for other personas.`
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

  const supersededIds = input.supersededIds ?? null;
  const lens = persona?.roleLens ?? {};
  const userNumbers = userNumberByIndex(messages);

  const entries: ProjectedEntry[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "notice") continue;
    if (m.role === "assistant" && m.errorMessage !== null) continue;
    // #180: drop superseded assistant rows so retry/replay don't pollute
    // a fresh run with their stale prior text.
    if (m.role === "assistant" && supersededIds?.has(m.id)) continue;

    // #102: hard floor from compaction — nothing below it enters context.
    const floor = conversation.compactionFloorIndex;
    if (floor !== null && m.index < floor) continue;

    if (limitMark !== null && m.index < limitMark && !m.pinned) continue;
    if (m.index < cutoff && !m.pinned) continue;

    if (m.pinned && m.pinTarget !== null && m.pinTarget !== personaKey) continue;

    if (m.role === "user" && m.addressedTo.length > 0 && !m.addressedTo.includes(personaKey)) {
      continue;
    }

    // #75: the visibility matrix is the single source of truth.
    // Missing key = full visibility (observer sees everyone).
    // Empty array = isolated (observer sees only self).
    // //visibility separated fills every key with []; //visibility full
    // clears the matrix to {}.
    // Audience filter (#4) is orthogonal: assistant rows scoped to a
    // specific audience are only visible to members of that audience,
    // regardless of the matrix.
    if (m.role === "assistant") {
      if (m.audience.length > 0 && !m.audience.includes(personaKey)) continue;
      const matrixRow = conversation.visibilityMatrix[personaKey];
      if (matrixRow !== undefined) {
        const sourceKey = messageKey(m);
        if (sourceKey !== personaKey && !matrixRow.includes(sourceKey)) continue;
      }
    }

    if (!m.content) continue;

    const sourceKey = m.role === "user" ? "user" : messageKey(m);
    // #213: persona role lens. Default mapping is preserved (user-row
    // → user, target's own assistant → assistant, other personas →
    // assistant). Lens entries flip the role for a specific source
    // speaker. The target's own messages are never re-projected — a
    // self-referential lens entry is meaningless and ignored.
    let projectedRole: "user" | "assistant";
    if (m.role === "assistant" && m.personaId === target.personaId) {
      projectedRole = "assistant";
    } else {
      const override = lens[sourceKey];
      projectedRole = override ?? (m.role === "user" ? "user" : "assistant");
    }

    // #87: prefix other personas' messages with their name so the
    // receiving LLM knows who said what. Decision is keyed off the
    // SOURCE row (not the projected role): a persona reply projected
    // to user-role still keeps "<name>: ", but the human user's own
    // messages stay raw.
    let content = m.content;
    if (m.role === "assistant" && m.personaId && m.personaId !== target.personaId) {
      const name = personas.find((p) => p.id === m.personaId)?.name;
      if (name) content = `${name}: ${content}`;
    }

    entries.push({
      role: projectedRole,
      content,
      speakerKey: sourceKey,
      sourceInfo: {
        pinned: m.pinned,
        userNumber: m.role === "user" ? (userNumbers.get(m.index) ?? null) : null,
      },
    });
  }

  // #73: DAG children in joined visibility may see sibling assistant
  // responses (from parents that completed earlier in this turn) after
  // the triggering user message. Providers like Mistral require the
  // last message to be 'user'. Detect this pattern (2+ trailing
  // assistants after the last user) and move the user message to the
  // end. A single trailing assistant is normal alternation and left
  // alone. Runs *before* normalization so the moved user can collapse
  // with adjacent user-role entries cleanly.
  if (entries.length >= 3 && entries[entries.length - 1]!.role === "assistant") {
    let lastUserIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    const trailingAssistants = entries.length - 1 - lastUserIdx;
    if (lastUserIdx >= 0 && trailingAssistants >= 2) {
      const [userEntry] = entries.splice(lastUserIdx, 1);
      entries.push(userEntry!);
    }
  }

  // #213: normalization. Anthropic 400s on consecutive same-role
  // messages; OpenAI tolerates it but undocumented. Collapse runs of
  // same-role entries into one — content joined with "\n\n", name-
  // prefixes preserved, sourceInfo merged (any-source-pinned,
  // userNumber dropped because the collapsed entry no longer maps to
  // a single user message).
  const normalized: ProjectedEntry[] = [];
  for (const e of entries) {
    const last = normalized[normalized.length - 1];
    if (last && last.role === e.role) {
      last.content = `${last.content}\n\n${e.content}`;
      last.sourceInfo = {
        pinned: last.sourceInfo.pinned || e.sourceInfo.pinned,
        userNumber: null,
      };
      last.speakerKey = "merged";
    } else {
      normalized.push({ ...e, sourceInfo: { ...e.sourceInfo } });
    }
  }

  const out: ChatMessage[] = normalized.map((e) => ({ role: e.role, content: e.content }));

  // #55: automatic context truncation. SourceInfo[] travels alongside
  // the messages from the same ProjectedEntry source so the truncator
  // can never disagree with the role-mapped output about pinned-ness
  // or user-message numbers.
  // #64: limitSizeTokens narrows the budget further.
  const providerMax = input.maxContextTokens ?? Infinity;
  const convLimit = conversation.limitSizeTokens ?? Infinity;
  const maxTokens = Math.min(providerMax, convLimit);
  if (maxTokens && maxTokens !== Infinity) {
    const sourceInfos: SourceInfo[] = normalized.map((e) => e.sourceInfo);
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
