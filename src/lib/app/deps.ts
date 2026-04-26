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
  Message,
  StreamStatus,
} from "@/lib/types";

// -----------------------------------------------------------------
// Reads — getters return current values without subscribing.
// -----------------------------------------------------------------

export interface MessagesReadDeps {
  getMessages: (conversationId: string) => readonly Message[];
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
  setLimit: (conversationId: string, limitMarkIndex: number | null) => Promise<void>;
  setLimitSize: (conversationId: string, limitSizeTokens: number | null) => Promise<void>;
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

// -----------------------------------------------------------------
// Composed shapes — what each use case actually needs. Keep these
// minimal: a use case that doesn't need a slice should not declare
// it (makes test mocks smaller and the dependency graph honest).
// -----------------------------------------------------------------

export type RunOneTargetDeps = MessagesReadDeps &
  Pick<MessagesWriteDeps, "appendPlaceholder" | "patchContent" | "patchError" | "appendNotice"> &
  SendStateDeps &
  UiReadDeps;

export type PostResponseCheckDeps = MessagesReadDeps &
  Pick<MessagesWriteDeps, "appendNotice" | "reloadMessages"> &
  PersonasReadDeps &
  ConversationsReadDeps &
  Pick<ConversationsWriteDeps, "setContextWarningsFired" | "setCompactionFloor" | "setLimit"> &
  Pick<SendStateDeps, "setTargetStatus" | "clearTargetStatus">;

export type SendMessageDeps = RunPlannedSendDeps &
  PostResponseCheckDeps &
  PersonasWriteDeps &
  Pick<MessagesWriteDeps, "appendUserMessage"> &
  Pick<ConversationsWriteDeps, "rename">;

export type RunPlannedSendDeps = RunOneTargetDeps & Pick<MessagesWriteDeps, "reloadMessages">;

export type RetryMessageDeps = RunOneTargetDeps &
  PersonasReadDeps &
  Pick<MessagesWriteDeps, "reloadMessages">;

// Replay does NOT auto-title or fire postResponseCheck — it just
// re-runs an already-titled conversation past the edited message —
// so deps stay narrower than SendMessageDeps.
export type ReplayMessageDeps = RunPlannedSendDeps & PersonasReadDeps & PersonasWriteDeps;

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
    | "setLimit"
    | "setLimitSize"
    | "setCompactionFloor"
    | "setDisplayMode"
    | "setVisibilityMatrix"
    | "setVisibilityPreset"
    | "setAutocompact"
  > &
  Pick<SendStateDeps, "setTargetStatus" | "clearTargetStatus">;
