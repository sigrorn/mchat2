// ------------------------------------------------------------------
// Component: Stream runner
// Responsibility: Execute one send to one target. Builds the context,
//                 creates an empty assistant message, consumes the
//                 adapter's stream (with retry), and flushes content +
//                 error state when it ends. Emits events to an optional
//                 observer so stores can show live tokens.
// Collaborators: context/builder.ts, persistence/messages.ts,
//                providers/adapter.ts, orchestration/retryManager.ts.
// ------------------------------------------------------------------

import type {
  Conversation,
  Message,
  Persona,
  PersonaTarget,
  ProviderId,
  StreamEvent,
} from "../types";
import { buildContext } from "../context/builder";
import type { ProviderAdapter } from "../providers/adapter";
import { PROVIDER_REGISTRY, type ProviderMeta } from "../providers/registry";
import * as messagesRepo from "../persistence/messages";
import { withRetry, DEFAULT_RETRY, type RetryPolicy } from "./retryManager";
import { buildOutboundRows, buildInboundRows } from "../tracing/traceWriter";

// Consumer-side sink for the per-persona trace files (#40). The file-
// backed implementation lives next to useSend; streamRunner is agnostic
// so unit tests can inject a record-only stub.
export interface TraceSink {
  outbound(rows: string[]): Promise<void> | void;
  inbound(rows: string[]): Promise<void> | void;
}

export interface StreamRunInput {
  streamId: string;
  conversation: Conversation;
  target: PersonaTarget;
  personas: Persona[];
  history: Message[];
  adapter: ProviderAdapter;
  apiKey: string | null;
  model: string;
  displayMode: "lines" | "cols";
  retry?: RetryPolicy;
  signal?: AbortSignal;
  // Adapter-specific runtime config (e.g. Apertus productId from the
  // persona). Passed through to adapter.stream as args.extraConfig.
  extraConfig?: Record<string, unknown>;
  // Called for every event emitted (including tokens) so the UI can
  // stream without polling the DB.
  onEvent?: (e: StreamEvent) => void;
  // When true, suppress per-token onEvent calls (#16 cols mode).
  // Tokens still accumulate and the final UPDATE flushes content;
  // only the live UI patching is silenced. usage/error/complete events
  // continue to flow through onEvent.
  bufferTokens?: boolean;
  // App-wide system prompt prepended above the persona/conversation
  // tier (#23). Plumbed straight through to buildContext.
  globalSystemPrompt?: string | null;
  // Per-persona trace sink (#40). When present, receives outbound rows
  // before the stream opens and inbound rows after the reply is known.
  traceSink?: TraceSink;
  // #58: called with the placeholder message id right after it's
  // persisted, BEFORE any token events fire. This lets the caller
  // patch by specific id instead of "the last assistant row".
  onPlaceholderCreated?: (messageId: string, placeholder: Message) => void;
}

export interface StreamRunOutcome {
  kind: "completed" | "failed" | "cancelled";
  messageId: string;
  errorMessage: string | null;
  errorTransient: boolean;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  // #55: how many messages buildContext dropped to fit the token limit.
  contextDropped: number;
  // The [N] user-message number of the first surviving non-pinned
  // message after truncation — for the notice text.
  contextFirstSurviving: number | null;
}

export async function runStream(input: StreamRunInput): Promise<StreamRunOutcome> {
  const { conversation, target, personas, history, adapter, signal, onEvent } = input;
  const providerMeta: ProviderMeta = PROVIDER_REGISTRY[target.provider];
  const { systemPrompt, messages, dropped, firstSurvivingUserNumber } = buildContext({
    conversation,
    target,
    messages: history,
    personas,
    globalSystemPrompt: input.globalSystemPrompt ?? null,
    maxContextTokens: providerMeta.maxContextTokens,
  });

  // Persist the empty shell up-front so the UI can render its bubble
  // and append tokens as they arrive.
  // Audience inherits the prior user row's addressedTo (issue #4):
  // every response to '@A @B hi' gets audience=[A,B] so either
  // persona sees all replies in that send group on the next turn.
  const priorUser = [...history].reverse().find((m) => m.role === "user");
  const audience = priorUser?.addressedTo ?? [];

  const placeholder = await messagesRepo.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    provider: target.provider satisfies ProviderId,
    model: input.model,
    personaId: target.personaId,
    displayMode: input.displayMode,
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience,
  });

  input.onPlaceholderCreated?.(placeholder.id, placeholder);

  let accumulated = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  let finalError: { message: string; transient: boolean } | null = null;
  let cancelled = false;

  // #40: emit the outbound rows once the built context is final and
  // before the adapter opens. Done inside the try/catch to guarantee
  // the inbound pairing below even on early abort.
  if (input.traceSink) {
    await input.traceSink.outbound(buildOutboundRows(new Date(), systemPrompt, messages));
  }

  const factory = (): AsyncIterable<StreamEvent> => {
    const args: Parameters<ProviderAdapter["stream"]>[0] = {
      streamId: input.streamId,
      model: input.model,
      messages,
      systemPrompt,
      apiKey: input.apiKey,
    };
    if (signal) args.signal = signal;
    if (input.extraConfig) args.extraConfig = input.extraConfig;
    return adapter.stream(args);
  };

  try {
    for await (const e of withRetry(
      input.streamId,
      factory,
      input.retry ?? DEFAULT_RETRY,
      signal,
    )) {
      // Drop late events from a previous attempt / cancelled run.
      if (e.streamId !== input.streamId) continue;
      // bufferTokens (#16): in cols mode, suppress per-token onEvent
      // so the UI doesn't see growing partial content. Other events
      // (usage/error/complete) still flow through.
      if (!(input.bufferTokens && e.type === "token")) {
        onEvent?.(e);
      }
      switch (e.type) {
        case "token":
          accumulated += e.text;
          break;
        case "usage":
          inputTokens = e.input;
          outputTokens = e.output;
          estimated = e.estimated;
          break;
        case "error":
          finalError = { message: e.message, transient: e.transient };
          break;
        case "cancelled":
          cancelled = true;
          break;
        case "retrying":
        case "complete":
          break;
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name !== "AbortError") {
      finalError = { message: (err as Error).message, transient: false };
    } else {
      cancelled = true;
    }
  }

  // #26/#27: a 'silent' stream (no tokens, no usage, no explicit error,
  // no cancellation) leaves a blank assistant bubble with no signal
  // about what failed. Treat it as a failure so the user sees a
  // diagnostic rather than wondering whether the request even left.
  if (!cancelled && !finalError && accumulated === "" && inputTokens === 0 && outputTokens === 0) {
    finalError = {
      message: "adapter produced no response (no tokens, no usage, no error)",
      transient: false,
    };
  }

  // #40: inbound rows mirror the old mchat one-row-per-reply convention
  // (multiline splits happen inside buildInboundRows). Empty content
  // emits nothing so silent-failed runs don't add a stray timestamp.
  if (input.traceSink) {
    await input.traceSink.inbound(buildInboundRows(new Date(), accumulated));
  }

  await messagesRepo.updateMessageContent(
    placeholder.id,
    accumulated,
    finalError?.message ?? null,
    finalError?.transient ?? false,
  );
  if (inputTokens > 0 || outputTokens > 0) {
    await messagesRepo.updateMessageUsage(placeholder.id, inputTokens, outputTokens, estimated);
  }

  const kind: StreamRunOutcome["kind"] = cancelled
    ? "cancelled"
    : finalError
      ? "failed"
      : "completed";
  return {
    kind,
    messageId: placeholder.id,
    errorMessage: finalError?.message ?? null,
    errorTransient: finalError?.transient ?? false,
    inputTokens,
    outputTokens,
    estimated,
    contextDropped: dropped,
    contextFirstSurviving: firstSurvivingUserNumber,
  };
}

// Resolve the model id to use for a target: persona override, else the
// provider default. Centralized so the send planner doesn't duplicate
// the logic.
export function modelForTarget(target: PersonaTarget, personas: Persona[]): string {
  if (target.personaId) {
    const p = personas.find((x) => x.id === target.personaId);
    if (p?.modelOverride) return p.modelOverride;
  }
  return PROVIDER_REGISTRY[target.provider].defaultModel;
}
