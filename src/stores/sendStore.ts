// ------------------------------------------------------------------
// Component: Send store
// Responsibility: Track active sends per conversation — streamIds,
//                 AbortControllers, and a run counter for DAG
//                 resumption. Business logic (planning, running) lives
//                 in hooks/useSend; the store is pure reactive state.
// Collaborators: hooks/useSend.ts, orchestration/*.
// ------------------------------------------------------------------

import { create } from "zustand";

export interface ActiveStream {
  streamId: string;
  controller: AbortController;
  target: string; // persona key
  startedAt: number;
}

// Per-persona inflight state for the PersonaPanel row colouring (#31).
//   queued    — DAG dependency hasn't run yet; adapter not contacted
//   streaming — adapter open, tokens / usage flowing
//   retrying  — last attempt failed transiently; runner is retrying
export type StreamStatus = "queued" | "streaming" | "retrying";

interface State {
  runIdByConversation: Record<string, number>;
  activeByConversation: Record<string, ActiveStream[]>;
  streamStatusByConversation: Record<string, Record<string, StreamStatus>>;
  nextRunId: (conversationId: string) => number;
  registerStream: (conversationId: string, s: ActiveStream) => void;
  finishStream: (conversationId: string, streamId: string) => void;
  cancelAll: (conversationId: string) => void;
  setTargetStatus: (conversationId: string, key: string, status: StreamStatus) => void;
  clearTargetStatus: (conversationId: string, key: string) => void;
}

export const useSendStore = create<State>((set, get) => ({
  runIdByConversation: {},
  activeByConversation: {},
  streamStatusByConversation: {},
  nextRunId(conversationId) {
    const current = get().runIdByConversation[conversationId] ?? 0;
    const next = current + 1;
    set({
      runIdByConversation: { ...get().runIdByConversation, [conversationId]: next },
    });
    return next;
  },
  registerStream(conversationId, s) {
    const existing = get().activeByConversation[conversationId] ?? [];
    set({
      activeByConversation: {
        ...get().activeByConversation,
        [conversationId]: [...existing, s],
      },
    });
  },
  finishStream(conversationId, streamId) {
    const existing = get().activeByConversation[conversationId] ?? [];
    set({
      activeByConversation: {
        ...get().activeByConversation,
        [conversationId]: existing.filter((x) => x.streamId !== streamId),
      },
    });
  },
  cancelAll(conversationId) {
    const existing = get().activeByConversation[conversationId] ?? [];
    for (const s of existing) s.controller.abort();
    set({
      activeByConversation: { ...get().activeByConversation, [conversationId]: [] },
      streamStatusByConversation: {
        ...get().streamStatusByConversation,
        [conversationId]: {},
      },
    });
  },
  setTargetStatus(conversationId, key, status) {
    const conv = get().streamStatusByConversation[conversationId] ?? {};
    set({
      streamStatusByConversation: {
        ...get().streamStatusByConversation,
        [conversationId]: { ...conv, [key]: status },
      },
    });
  },
  clearTargetStatus(conversationId, key) {
    const conv = { ...(get().streamStatusByConversation[conversationId] ?? {}) };
    delete conv[key];
    set({
      streamStatusByConversation: {
        ...get().streamStatusByConversation,
        [conversationId]: conv,
      },
    });
  },
}));
