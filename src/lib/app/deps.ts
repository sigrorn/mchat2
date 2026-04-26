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

import type { ActiveStream, Message, StreamStatus } from "@/lib/types";

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

export interface UiReadDeps {
  getStreamResponses: () => boolean;
  getDebugSession: () => { id: string; startedAt: number } | null;
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
}

export interface PersonasWriteDeps {
  setSelection: (conversationId: string, selection: readonly string[]) => void;
}

export interface ConversationsWriteDeps {
  rename: (conversationId: string, title: string) => Promise<void>;
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
  Pick<MessagesWriteDeps, "appendNotice"> &
  PersonasReadDeps &
  // Limit-mark / compaction-floor mutations live on the conversations
  // store today; widen this when #149 lands and we know the exact set.
  ConversationsWriteDeps;

export type SendMessageDeps = MessagesReadDeps &
  MessagesWriteDeps &
  PersonasReadDeps &
  PersonasWriteDeps &
  ConversationsWriteDeps &
  SendStateDeps &
  UiReadDeps;

export type RetryMessageDeps = MessagesReadDeps &
  Pick<MessagesWriteDeps, "reloadMessages"> &
  PersonasReadDeps &
  SendStateDeps &
  UiReadDeps;

export type ReplayMessageDeps = SendMessageDeps;
