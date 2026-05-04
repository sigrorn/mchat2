// ------------------------------------------------------------------
// Component: AppDeps interfaces
// Responsibility: Define the dependency-injection shape that use-case
//                 functions under src/lib/app accept instead of
//                 importing Zustand stores directly. Each interface
//                 captures one concern; use cases compose only the
//                 ones they actually need (#147 / #144).
// Collaborators: stores/*Store.ts (the React hook layer wires deps
//                from these); src/lib/app/* (use cases consume them).
// ------------------------------------------------------------------

import type {
  ActiveStream,
  AutocompactThreshold,
  Conversation,
  Flow,
  Message,
  Persona,
  ProviderId,
  StreamStatus,
} from "@/lib/types";
import type { ProviderAdapter } from "@/lib/providers/adapter";
import type { TraceSink } from "@/lib/orchestration/streamRunner";

// -----------------------------------------------------------------
// Reads — getters return current values without subscribing.
// -----------------------------------------------------------------

export interface MessagesReadDeps {
  getMessages: (conversationId: string) => readonly Message[];
  // #180: ids of assistant rows whose Attempt has been superseded by
  // a later one. Empty set when nothing is superseded. Use cases that
  // build LLM context (sendMessage, replayMessage, retryMessage,
  // postResponseCheck, runCompaction) read this and forward it so
  // buildContext can drop the stale rows.
  getSupersededIds: (conversationId: string) => ReadonlySet<string>;
}

export interface PersonasReadDeps {
  getPersonas: (conversationId: string) => readonly import("@/lib/types").Persona[];
  getSelection: (conversationId: string) => readonly string[];
}

export interface UiDebugSession {
  enabled: boolean;
  sessionTimestamp: string | null;
}

export interface UiReadDeps {
  getStreamResponses: () => boolean;
  getDebugSession: () => UiDebugSession;
  getWorkingDir: () => string | null;
}

// -----------------------------------------------------------------
// Writes — async or sync mutations matching the store action API.
// -----------------------------------------------------------------

export interface MessagesWriteDeps {
  reloadMessages: (conversationId: string) => Promise<void>;
  appendUserMessage: (args: {
    conversationId: string;
    content: string;
    addressedTo: readonly string[];
    pinned: boolean;
    // #231: true when sendMessage decided this dispatch is flow-managed.
    // Persisted on the row so the chat header can mark it.
    flowDispatched: boolean;
  }) => Promise<void>;
  appendPlaceholder: (msg: Message) => void;
  patchContent: (conversationId: string, messageId: string, content: string) => void;
  patchError: (
    conversationId: string,
    messageId: string,
    info: { errorMessage: string | null; errorTransient: boolean },
  ) => void;
  appendNotice: (conversationId: string, content: string) => Promise<Message>;
  setPinned: (conversationId: string, messageId: string, pinned: boolean) => Promise<void>;
  setEditing: (conversationId: string, messageId: string | null) => void;
  setReplayQueue: (conversationId: string, queue: readonly string[]) => void;
}

export interface PersonasWriteDeps {
  setSelection: (conversationId: string, selection: readonly string[]) => void;
}

export interface ConversationsReadDeps {
  getConversation: (conversationId: string) => Conversation | undefined;
}

export interface ConversationsWriteDeps {
  rename: (conversationId: string, title: string) => Promise<void>;
  setContextWarningsFired: (conversationId: string, fired: number[]) => Promise<void>;
  setCompactionFloor: (conversationId: string, floorIndex: number | null) => Promise<void>;
  // #240: setLimit / setLimitSize removed alongside the //limit and
  // //limitsize commands. Auto-truncation is per-model (#261) and
  // happens inside buildContext at send time.
  setDisplayMode: (conversationId: string, mode: "lines" | "cols") => Promise<void>;
  setVisibilityMatrix: (
    conversationId: string,
    matrix: Record<string, string[]>,
  ) => Promise<void>;
  setVisibilityPreset: (
    conversationId: string,
    mode: "separated" | "joined",
    personaIds: readonly string[],
  ) => Promise<void>;
  setAutocompact: (
    conversationId: string,
    threshold: AutocompactThreshold | null,
  ) => Promise<void>;
}

export interface SendStateDeps {
  nextRunId: (conversationId: string) => number;
  registerStream: (conversationId: string, stream: ActiveStream) => void;
  finishStream: (conversationId: string, streamId: string) => void;
  setTargetStatus: (conversationId: string, key: string, status: StreamStatus) => void;
  clearTargetStatus: (conversationId: string, key: string) => void;
}

// #217: flow read/write surface. Use cases never import flowsRepo
// directly so faking + replacement remain trivial. The shapes mirror
// flowsRepo getFlow/setStepIndex 1:1.
export interface FlowReadDeps {
  getFlow: (conversationId: string) => Promise<Flow | null>;
}
export interface FlowWriteDeps {
  setFlowStepIndex: (flowId: string, index: number) => Promise<void>;
  // #223: persist the conversation's flow_mode flag. The use case
  // calls this after a flow-advancing send so the next reload sees
  // the auto-managed-selection state.
  setFlowMode: (conversationId: string, on: boolean) => Promise<void>;
}

// -----------------------------------------------------------------
// Infrastructure deps — keychain, settings, adapters, RAF, tracing
// (#168). Replaces direct imports of lib/tauri/keychain,
// lib/persistence/settings, lib/providers/registryOfAdapters,
// lib/tracing/traceFileSink, and globalThis.requestAnimationFrame
// inside src/lib/app/* so use cases can be unit-tested against fakes
// without spinning up the React tree.
// -----------------------------------------------------------------

export interface KeychainDeps {
  getApiKey: (provider: ProviderId) => Promise<string | null>;
}

export interface SettingsReadDeps {
  getGlobalSystemPrompt: () => Promise<string | null>;
  getIdleTimeoutMs: () => Promise<number>;
  getMaxRetryAttempts: () => Promise<number>;
}

export interface AdapterRegistryDeps {
  getAdapter: (provider: ProviderId) => ProviderAdapter;
  resolveExtraConfig: (
    provider: ProviderId,
    persona: Persona | null,
  ) => Promise<Record<string, unknown> | undefined>;
}

// Direct repo write that pre-allocates idx and returns the persisted
// row synchronously (modulo the awaits inside the repo). Used by
// runOneTarget so the assistant placeholder lands at a deterministic
// index before any subsequent awaits.
export interface MessagesRepoWriteDeps {
  appendAssistantPlaceholder: (
    args: Omit<Message, "id" | "index" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    },
  ) => Promise<Message>;
}

export interface TracingDeps {
  makeTraceSink: (args: {
    workingDir: string;
    sessionTimestamp: string;
    conversationId: string;
    slug: string;
  }) => TraceSink | undefined;
}

// requestAnimationFrame / cancelAnimationFrame abstraction. Default
// wires to globalThis; tests can supply a synchronous shim.
export interface FrameDeps {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
}

// -----------------------------------------------------------------
// Composed shapes — what each use case actually needs. Keep these
// minimal: a use case that doesn't need a slice should not declare
// it (makes test mocks smaller and the dependency graph honest).
// -----------------------------------------------------------------

export type RunOneTargetDeps = MessagesReadDeps &
  Pick<MessagesWriteDeps, "appendPlaceholder" | "patchContent" | "patchError" | "appendNotice"> &
  SendStateDeps &
  UiReadDeps &
  KeychainDeps &
  SettingsReadDeps &
  AdapterRegistryDeps &
  MessagesRepoWriteDeps &
  TracingDeps &
  FrameDeps;

export type PostResponseCheckDeps = MessagesReadDeps &
  Pick<MessagesWriteDeps, "appendNotice" | "reloadMessages"> &
  PersonasReadDeps &
  ConversationsReadDeps &
  Pick<ConversationsWriteDeps, "setContextWarningsFired" | "setCompactionFloor"> &
  Pick<SendStateDeps, "setTargetStatus" | "clearTargetStatus"> &
  Pick<SettingsReadDeps, "getGlobalSystemPrompt">;

export type SendMessageDeps = RunPlannedSendDeps &
  PostResponseCheckDeps &
  PersonasWriteDeps &
  Pick<MessagesWriteDeps, "appendUserMessage"> &
  Pick<ConversationsWriteDeps, "rename"> &
  KeychainDeps &
  AdapterRegistryDeps &
  FlowReadDeps &
  FlowWriteDeps;

export type RunPlannedSendDeps = RunOneTargetDeps & Pick<MessagesWriteDeps, "reloadMessages">;

export type RetryMessageDeps = RunOneTargetDeps &
  PersonasReadDeps &
  Pick<MessagesWriteDeps, "reloadMessages">;

// Replay does NOT auto-title or fire postResponseCheck — it just
// re-runs an already-titled conversation past the edited message —
// so deps stay narrower than SendMessageDeps. #219: reads/writes the
// flow cursor so an edit can rewind to the user step that fed the
// truncated runs.
export type ReplayMessageDeps = RunPlannedSendDeps &
  PersonasReadDeps &
  PersonasWriteDeps &
  FlowReadDeps &
  FlowWriteDeps;

// #224: store-switching surface for the //fork handler. Loads the
// fresh conversation list, picks the new id as current, and reloads
// the per-conversation panes so the UI doesn't need to wait for a
// window refresh. Kept as its own slice (not folded into Conversations-
// WriteDeps) because it touches three stores at once.
export interface ConversationSwitchDeps {
  reloadConversations: () => Promise<void>;
  selectConversation: (conversationId: string) => void;
  loadPersonas: (conversationId: string) => Promise<void>;
  loadMessages: (conversationId: string) => Promise<void>;
}

// Surface needed by the //command handlers (#154). Spans every store
// the command dispatcher reaches into. Each handler should access
// only the slice it actually uses; this composed type captures the
// union for the dispatcher's CommandContext.
export type CommandDeps = MessagesReadDeps &
  PersonasReadDeps &
  Pick<
    MessagesWriteDeps,
    "appendNotice" | "reloadMessages" | "setPinned" | "setEditing" | "setReplayQueue"
  > &
  PersonasWriteDeps &
  Pick<
    ConversationsWriteDeps,
    | "setCompactionFloor"
    | "setDisplayMode"
    | "setVisibilityMatrix"
    | "setVisibilityPreset"
    | "setAutocompact"
  > &
  // #264: //activeprompts reads the global system prompt to render the
  // top layer of the per-persona composition stack. Reuses the same
  // SettingsReadDeps slice that postResponseCheck already pulls from.
  Pick<SettingsReadDeps, "getGlobalSystemPrompt"> &
  Pick<SendStateDeps, "setTargetStatus" | "clearTargetStatus"> &
  // #224: //fork needs to read the source flow and switch the UI to
  // the freshly-created fork. FlowReadDeps gives the read; Conversation-
  // SwitchDeps gives the three-store handoff (mirrors snapshot import).
  FlowReadDeps &
  // #232: //pop rewinds the flow cursor like replayMessage does so a
  // subsequent @convo at the implied user-step actually triggers flow
  // dispatch. setFlowMode included for symmetry with sendMessageDeps.
  FlowWriteDeps &
  ConversationSwitchDeps;
