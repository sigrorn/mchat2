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
import { PRICING } from "../pricing/table";
import { withRetry, DEFAULT_RETRY, type RetryPolicy } from "./retryManager";
import { buildOutboundRows, buildInboundRows } from "../tracing/traceWriter";
import { logBuffer } from "../observability/logBuffer";

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
  // #124: per-chunk idle timeout forwarded to the adapter. > 0 enables
  // the watchdog; absent/0 keeps the old no-timeout behavior.
  idleTimeoutMs?: number;
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
  // #117: optional pre-created placeholder. When the caller has
  // pre-appended placeholders in a sorted order (to keep multi-persona
  // display stable), it passes the placeholder id here so runStream
  // skips its own appendMessage and doesn't allocate a new index.
  placeholderId?: string;
  // #180: ids of assistant rows whose Attempt was superseded by a
  // later one. Forwarded to buildContext so the LLM doesn't see stale
  // replies left in place by retry/replay.
  supersededIds?: ReadonlySet<string>;
  // #230: when this dispatch is part of a flow personas-step that has
  // a hidden instruction configured, forward it so buildContext can
  // append "Step note: <text>" to the system block.
  stepInstruction?: string | null;
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
  const buildArgs: Parameters<typeof buildContext>[0] = {
    conversation,
    target,
    messages: history,
    personas,
    globalSystemPrompt: input.globalSystemPrompt ?? null,
    maxContextTokens: providerMeta.maxContextTokens,
  };
  if (input.supersededIds) buildArgs.supersededIds = input.supersededIds;
  if (input.stepInstruction != null) buildArgs.stepInstruction = input.stepInstruction;
  const { systemPrompt, messages, dropped, firstSurvivingUserNumber } = buildContext(buildArgs);

  // Persist the empty shell up-front so the UI can render its bubble
  // and append tokens as they arrive.
  // Audience inherits the prior user row's addressedTo (issue #4):
  // every response to '@A @B hi' gets audience=[A,B] so either
  // persona sees all replies in that send group on the next turn.
  let placeholder: Message;
  if (input.placeholderId) {
    // #117: caller pre-appended the placeholder (see useSend) to lock
    // display order. Look it up rather than creating a new row.
    const existing = await messagesRepo.getMessage(input.placeholderId);
    if (!existing) {
      throw new Error(`runStream: pre-appended placeholder ${input.placeholderId} not found`);
    }
    placeholder = existing;
  } else {
    const priorUser = [...history].reverse().find((m) => m.role === "user");
    const audience = priorUser?.addressedTo ?? [];
    placeholder = await messagesRepo.appendMessage({
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
  }

  input.onPlaceholderCreated?.(placeholder.id, placeholder);

  let accumulated = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  let finalError: { message: string; transient: boolean } | null = null;
  let cancelled = false;
  // #122 — streaming timings for //stats aggregation.
  let streamOpenAt: number | null = null;
  let firstTokenAt: number | null = null;
  let completeAt: number | null = null;

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
    if (input.idleTimeoutMs && input.idleTimeoutMs > 0) args.idleTimeoutMs = input.idleTimeoutMs;
    return adapter.stream(args);
  };

  // #122 — mark stream open just before the first adapter iteration.
  // Within ~5ms of the actual socket write; any gap is dwarfed by
  // network and model latency.
  streamOpenAt = Date.now();
  // #129 — observability: one event per lifecycle transition.
  const emit = (
    event: Parameters<typeof logBuffer.push>[0]["event"],
    extra: {
      statusOrReason?: string | null;
      elapsedMs?: number | null;
      bytes?: number | null;
    } = {},
  ): void => {
    logBuffer.push({
      ts: Date.now(),
      personaId: target.personaId ?? null,
      provider: target.provider,
      model: input.model,
      event,
      statusOrReason: extra.statusOrReason ?? null,
      elapsedMs: extra.elapsedMs ?? null,
      bytes: extra.bytes ?? null,
    });
  };
  emit("open");
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
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
            emit("first-byte", {
              elapsedMs: streamOpenAt !== null ? firstTokenAt - streamOpenAt : null,
            });
          }
          accumulated += e.text;
          break;
        case "usage":
          inputTokens = e.input;
          outputTokens = e.output;
          estimated = e.estimated;
          emit("usage", {
            statusOrReason: `in=${inputTokens} out=${outputTokens}${estimated ? " (est)" : ""}`,
          });
          break;
        case "error":
          finalError = { message: e.message, transient: e.transient };
          emit("error", {
            statusOrReason: `${e.transient ? "transient" : "final"}: ${e.message}`,
            bytes: accumulated.length,
          });
          break;
        case "cancelled":
          cancelled = true;
          emit("cancelled", { bytes: accumulated.length });
          break;
        case "retrying":
          // On a retry restart, reset stream-open to the new attempt
          // and drop any first-token captured from the earlier one.
          emit("retrying", {
            statusOrReason: `attempt ${e.attempt}/${e.max}: ${e.reason}`,
          });
          streamOpenAt = Date.now();
          firstTokenAt = null;
          break;
        case "complete":
          completeAt = Date.now();
          emit("complete", {
            elapsedMs: streamOpenAt !== null ? completeAt - streamOpenAt : null,
            bytes: accumulated.length,
          });
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
  // (multiline splits happen inside buildInboundRows). Empty content +
  // no error still emits nothing so genuinely silent failures don't
  // add a stray timestamp.
  // #205: pass finalError so HTTP 400 / validation failures land in
  // the trace for diagnosis instead of leaving the file with only
  // outbound requests.
  if (input.traceSink) {
    await input.traceSink.inbound(buildInboundRows(new Date(), accumulated, finalError));
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
  // #252: snapshot the per-message USD cost from the PRICING table at
  // the time of completion. Honest about unknowns: when the
  // (provider, model) isn't in PRICING (notably every openai_compat
  // row today), persist NULL — the spend table renders that as "?".
  // No fallback to provider median; a guessed snapshot would corrupt
  // the historical-accuracy contract. Failed / cancelled rows still
  // get a snapshot since the tokens were billed by the provider.
  const targetModel = modelForTarget(target, personas);
  const providerPricing = PRICING[target.provider] ?? {};
  const entry = providerPricing[targetModel];
  const costUsd =
    entry !== undefined
      ? (inputTokens / 1_000_000) * entry.inputUsdPerMTok +
        (outputTokens / 1_000_000) * entry.outputUsdPerMTok
      : null;
  await messagesRepo.updateMessageCost(placeholder.id, costUsd);
  // #122 — record timings only on successful completion. Failed /
  // cancelled / silent streams leave ttft_ms + stream_ms NULL so
  // //stats averages exclude them.
  if (
    !finalError &&
    !cancelled &&
    streamOpenAt !== null &&
    firstTokenAt !== null &&
    completeAt !== null
  ) {
    const ttftMs = firstTokenAt - streamOpenAt;
    const streamMs = completeAt - firstTokenAt;
    if (ttftMs >= 0 && streamMs >= 0) {
      await messagesRepo.updateMessageTiming(placeholder.id, ttftMs, streamMs);
    }
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
