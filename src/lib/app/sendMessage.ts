// ------------------------------------------------------------------
// Component: sendMessage (lib/app)
// Responsibility: The full "send this user text" use case. Resolves
//                 @-targets, persists the user row, runs the planned
//                 send via runPlannedSend, fires the post-response
//                 autocompact / context-warning check, and kicks off
//                 the auto-title flow on first reply (#54). Originally
//                 part of useSend.send; lifted here in #151.
//                 #217: when a conversation flow is attached and the
//                 resolved targets match the next personas-step, the
//                 cursor advances and recordSend stamps flow_step_id
//                 so #219's edit-replay rewind can find its way back.
// Collaborators: lib/personas/resolver, lib/personas/resolveWithFlow,
//                lib/conversations/autoTitle, lib/app/runPlannedSend,
//                lib/app/postResponseCheck, lib/app/sendSelection,
//                lib/app/flowDispatch, hooks/useSend (wires deps).
// ------------------------------------------------------------------

import type { Conversation, Flow, FlowStep, Persona, PersonaTarget } from "@/lib/types";
import { resolveTargets, type ResolveResult } from "@/lib/personas/resolver";
import { resolveTargetsWithFlow } from "@/lib/personas/resolveWithFlow";
import { generateTitle } from "@/lib/conversations/autoTitle";
import { modelForTarget } from "@/lib/orchestration/streamRunner";
import { recordSend } from "@/lib/orchestration/recordSend";
import { selectionAfterResolve } from "./sendSelection";
import { runPlannedSend } from "./runPlannedSend";
import { postResponseCheck } from "./postResponseCheck";
import {
  addressedToForSend,
  planFlowDispatch,
  shouldAdvanceCursor,
  wrapNextIndex,
} from "./flowDispatch";
import { nextPersonasStepPersonaIds } from "./flowSelectionSync";
import type { SendMessageDeps } from "./deps";

export interface SendMessageArgs {
  conversation: Conversation;
  text: string;
  pinned?: boolean;
}

export type SendMessageResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function sendMessage(
  deps: SendMessageDeps,
  args: SendMessageArgs,
): Promise<SendMessageResult> {
  const { conversation, text, pinned } = args;
  const personas = deps.getPersonas(conversation.id);
  const selection = deps.getSelection(conversation.id);

  const resolvedRaw = resolveTargets({
    text,
    personas: [...personas],
    selection: [...selection],
  });
  if (resolvedRaw.unknown.length > 0) {
    return {
      ok: false,
      reason: `unknown target${resolvedRaw.unknown.length === 1 ? "" : "s"}: ${resolvedRaw.unknown
        .map((u) => `@${u}`)
        .join(", ")}`,
    };
  }

  // #216/#217: flow-aware target wrapper. Inflates @convo to the next
  // personas-step's set; narrows @all to the same when a flow is
  // attached. Other modes pass through.
  const flow = await deps.getFlow(conversation.id);
  const resolved = resolveTargetsWithFlow(resolvedRaw, {
    flow,
    personas: [...personas],
  });

  if (resolved.targets.length === 0) return { ok: false, reason: "no targets" };

  if (resolved.mode !== "implicit") {
    const nextSelection = selectionAfterResolve(resolved, [...selection]);
    deps.setSelection(conversation.id, nextSelection);
  }

  // #217: detect flow-managed dispatch. Set-equality check against the
  // next personas-step. Mismatch (or single-target send) falls through
  // to today's runPlannedSend with runs_after-driven ordering intact.
  // #227: must compute this BEFORE persisting the user message so the
  // addressedTo can be expanded to cover the full chain — otherwise
  // chained downstream personas can't see the user message.
  const dispatchPlan = planFlowDispatch(flow, resolved.targets, resolved.mode);

  // #130: always persist the resolved target list. Implicit sends used
  // to store [], which made assistant replies' audience empty and
  // broke cols-mode grouping. userHeader keeps the "@all" shorthand
  // when the list covers every active persona.
  // #227: when the dispatch is flow-managed, expand addressedTo to the
  // union of every persona that will run in the chain so each chained
  // persona's context-build sees the user message.
  const addressedTo = addressedToForSend(
    resolved.targets.map((t) => t.key),
    flow,
    dispatchPlan,
  );

  await deps.appendUserMessage({
    conversationId: conversation.id,
    content: resolved.strippedText,
    addressedTo,
    pinned: pinned ?? false,
    // #231: flag the row when this dispatch took the flow-managed
    // path so the chat header can render '→ conversation → …'.
    flowDispatched: dispatchPlan.shouldDispatchAsFlow,
  });
  const lastTitleTarget = await runDispatch(deps, {
    conversation,
    personas: [...personas],
    initialResolved: resolved,
    flow,
    dispatchPlan,
  });

  // #105: post-response autocompact / context warnings.
  void postResponseCheck(deps, conversation.id);

  // #54: auto-title — fire-and-forget after the first user/assistant
  // exchange of a fresh conversation.
  if (conversation.title === "New conversation" && lastTitleTarget) {
    const freshHistory = deps.getMessages(conversation.id);
    const firstUser = freshHistory.find((m) => m.role === "user" && !m.pinned);
    const firstAssistant = freshHistory.find(
      (m) => m.role === "assistant" && !m.errorMessage && m.content,
    );
    if (firstUser && firstAssistant) {
      void (async () => {
        try {
          const ak = await deps.getApiKey(lastTitleTarget.provider);
          const title = await generateTitle(
            deps.getAdapter(lastTitleTarget.provider),
            ak,
            modelForTarget(lastTitleTarget, [...personas]),
            firstUser.content,
            firstAssistant.content,
          );
          if (title) {
            await deps.rename(conversation.id, title);
          }
        } catch {
          // Silent discard — auto-title is best-effort.
        }
      })();
    }
  }

  return { ok: true };
}

interface DispatchInput {
  conversation: Conversation;
  personas: Persona[];
  initialResolved: ResolveResult;
  flow: Flow | null;
  dispatchPlan: ReturnType<typeof planFlowDispatch>;
}

// Either runs today's single dispatch (no flow / no match) or chains
// through consecutive personas-steps until the cursor reaches a `user`
// step or wraps to step 0. Returns the last target seen — used to
// pick the auto-title generator.
async function runDispatch(
  deps: SendMessageDeps,
  input: DispatchInput,
): Promise<PersonaTarget | null> {
  const { conversation, personas, initialResolved, flow, dispatchPlan } = input;

  if (!dispatchPlan.shouldDispatchAsFlow || !flow || !dispatchPlan.nextStep) {
    // Today's path. runs_after edges still apply via planSend.
    const result = await runPlannedSend(deps, {
      conversation,
      resolved: initialResolved,
      personas,
    });
    if (!result.ok) return null;
    await persistRunRows(deps, conversation, personas, result.outcomes, null);
    return result.allTargets[0] ?? null;
  }
  // Flow-managed path. Each iteration of the loop dispatches one
  // personas-step; the step's instruction (#230) lands on every
  // persona's system block via runPlannedSend → runOneTarget →
  // buildContext.

  // Flow-managed dispatch loop.
  let activeFlow: Flow = flow;
  let activeStep: FlowStep = dispatchPlan.nextStep;
  let activeStepIndex = dispatchPlan.nextStepIndex!;
  let lastTarget: PersonaTarget | null = null;

  // Advance cursor onto the first personas step before running it,
  // so a mid-stream crash leaves the cursor at the step that was
  // actually executing (matches today's "no in-flight persistence"
  // stance — the user re-types and the step re-runs).
  await deps.setFlowStepIndex(activeFlow.id, activeStepIndex);

  // First iteration uses the user's resolved targets (which equal
  // the step by the planFlowDispatch invariant). Subsequent
  // iterations build the resolved set from the step's persona ids
  // directly.
  let resolved: ResolveResult = initialResolved;

  for (;;) {
    const result = await runPlannedSend(deps, {
      conversation,
      resolved,
      personas,
      stepInstruction: activeStep.instruction,
    });
    if (!result.ok) return lastTarget;
    await persistRunRows(deps, conversation, personas, result.outcomes, activeStep.id);
    lastTarget = result.allTargets[0] ?? lastTarget;

    if (!shouldAdvanceCursor(result.outcomes)) {
      // Stay at this personas-step; user can re-type to retry.
      // #223: still flip flow_mode on — the user signaled flow
      // intent and we want the panel to reflect that even on
      // partial failure. Selection stays as the current step's
      // set (no advance happened).
      await deps.setFlowMode(conversation.id, true);
      return lastTarget;
    }

    // Advance cursor. #220: a wrap (past last step) lands at
    // flow.loopStartIndex and always pauses, regardless of what
    // step kind the loop-start happens to be — the cycle hands
    // control back to the user at the cycle boundary.
    const { index: nextIndex, wrapped } = wrapNextIndex(
      activeFlow,
      activeStepIndex,
    );
    if (wrapped) {
      await pauseFlow(deps, conversation.id, activeFlow, nextIndex);
      return lastTarget;
    }

    const nextStep = activeFlow.steps[nextIndex];
    if (!nextStep) {
      await pauseFlow(deps, conversation.id, activeFlow, nextIndex);
      return lastTarget;
    }
    if (nextStep.kind === "user") {
      // Park here; next user message will trigger the following
      // personas step.
      await pauseFlow(deps, conversation.id, activeFlow, nextIndex);
      return lastTarget;
    }

    // Consecutive personas step — auto-chain. Build the resolved
    // set from the step's persona ids.
    activeStep = nextStep;
    activeStepIndex = nextIndex;
    activeFlow = { ...activeFlow, currentStepIndex: nextIndex };
    await deps.setFlowStepIndex(activeFlow.id, activeStepIndex);
    resolved = stepToResolved(activeStep, personas);
  }
}

// #223: flow paused at a user-step (or wrapped). Persist the cursor,
// flip flow_mode on, and auto-sync the conversation's persona
// selection to the *next* personas-step's set so the user's next
// implicit follow-up matches that step and advances the flow without
// having to type @convo.
async function pauseFlow(
  deps: SendMessageDeps,
  conversationId: string,
  flow: Flow,
  pausedAtIndex: number,
): Promise<void> {
  await deps.setFlowStepIndex(flow.id, pausedAtIndex);
  await deps.setFlowMode(conversationId, true);
  // Build a synthetic flow object with the new cursor so the
  // walker picks the right next-personas-step (skipping setup
  // when wrapping).
  const updated: Flow = { ...flow, currentStepIndex: pausedAtIndex };
  const syncedIds = nextPersonasStepPersonaIds(updated);
  if (syncedIds && syncedIds.length > 0) {
    deps.setSelection(conversationId, syncedIds);
  }
}

function stepToResolved(step: FlowStep, personas: readonly Persona[]): ResolveResult {
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const targets: PersonaTarget[] = [];
  for (const id of step.personaIds) {
    const p = personaById.get(id);
    if (!p) continue;
    targets.push({
      provider: p.provider,
      personaId: p.id,
      key: p.id,
      displayName: p.name,
    });
  }
  return { mode: "convo", targets, strippedText: "", unknown: [] };
}

async function persistRunRows(
  deps: SendMessageDeps,
  conversation: Conversation,
  personas: readonly Persona[],
  outcomes: ReadonlyArray<{ messageId: string | null; targetKey: string; kind: string }>,
  flowStepId: string | null,
): Promise<void> {
  const messagesById = new Map(
    deps.getMessages(conversation.id).map((m) => [m.id, m] as const),
  );
  const newAssistantMessages = outcomes
    .filter((o) => o.messageId !== null)
    .map((o) => messagesById.get(o.messageId!))
    .filter((m): m is NonNullable<typeof m> => m !== undefined && m.role === "assistant")
    .sort((a, b) => a.index - b.index)
    .map((m) => ({
      id: m.id,
      personaId: m.personaId,
      targetKey: personas.find((p) => p.id === m.personaId)?.nameSlug ?? m.personaId ?? "",
      provider: m.provider,
      model: m.model,
      content: m.content,
      createdAt: m.createdAt,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      ttftMs: m.ttftMs ?? null,
      streamMs: m.streamMs ?? null,
      errorMessage: m.errorMessage,
      errorTransient: m.errorTransient,
    }));
  await recordSend({
    conversationId: conversation.id,
    now: Date.now(),
    newAssistantMessages,
    flowStepId,
  });
}
