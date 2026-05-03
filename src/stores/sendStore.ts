// ------------------------------------------------------------------
// Component: Send store
// Responsibility: Track active sends per conversation — streamIds,
//                 AbortControllers, and a run counter for DAG
//                 resumption. Business logic (planning, running) lives
//                 in hooks/useSend; the store is pure reactive state.
// Collaborators: hooks/useSend.ts, orchestration/*.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { ActiveStream, StreamStatus } from "@/lib/types/stream";

// Re-export so existing importers ({ ActiveStream, StreamStatus } from
// "@/stores/sendStore") keep working. The canonical home is
// src/lib/types/stream.ts so use-case code under src/lib/app can
// reference these without violating the lib→stores boundary (#142).
export type { ActiveStream, StreamStatus };

interface State {
  runIdByConversation: Record<string, number>;
  activeByConversation: Record<string, ActiveStream[]>;
  streamStatusByConversation: Record<string, Record<string, StreamStatus>>;
  // #249: per-conversation Composer "submit-in-progress" lock. Covers
  // the prelude window between the user clicking Send and the first
  // stream registering (target resolution, user-message DB write,
  // flow lookup). Without this, the local component-state lock in
  // Composer.tsx bled across conversation switches and disabled the
  // Send button in conversations that weren't even the one streaming.
  submittingByConversation: Record<string, boolean>;
  nextRunId: (conversationId: string) => number;
  registerStream: (conversationId: string, s: ActiveStream) => void;
  finishStream: (conversationId: string, streamId: string) => void;
  cancelAll: (conversationId: string) => void;
  setTargetStatus: (conversationId: string, key: string, status: StreamStatus) => void;
  clearTargetStatus: (conversationId: string, key: string) => void;
  setSubmitting: (conversationId: string, value: boolean) => void;
}

export const useSendStore = create<State>((set, get) => ({
  runIdByConversation: {},
  activeByConversation: {},
  streamStatusByConversation: {},
  submittingByConversation: {},
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
  setSubmitting(conversationId, value) {
    set({
      submittingByConversation: {
        ...get().submittingByConversation,
        [conversationId]: value,
      },
    });
  },
}));
