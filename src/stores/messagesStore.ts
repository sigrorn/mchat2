// ------------------------------------------------------------------
// Component: Messages store
// Responsibility: Per-conversation UI state for the message list:
//                 which row is in edit/replay mode, the
//                 cross-conversation replay queue, and the
//                 superseded-id set used by the UI hide-filter.
//                 Persistent message data lives in repoQueryCache,
//                 not here (#211).
// Collaborators: persistence/messages.ts, repoQueryCache.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { Message } from "@/lib/types";
import * as repo from "@/lib/persistence/messages";
import { listSupersededMessageIds } from "@/lib/persistence/runs";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";

// Cache helpers: writes to repoQueryCache so useRepoQuery consumers
// see updates without re-fetching. Reads inside this file go through
// cache.get().
const messagesQueryKey = (conversationId: string): readonly unknown[] =>
  ["messages", conversationId];
function cacheUpdate(conversationId: string, fn: (msgs: Message[]) => Message[]): void {
  getRepoQueryCache().update<Message[]>(messagesQueryKey(conversationId), fn);
}
function cacheSet(conversationId: string, list: Message[]): void {
  getRepoQueryCache().set<Message[]>(messagesQueryKey(conversationId), list);
}
function cacheGet(conversationId: string): Message[] {
  return getRepoQueryCache().get<Message[]>(messagesQueryKey(conversationId)) ?? [];
}

interface State {
  // #180: per-conversation set of message ids whose Attempt has been
  // superseded. Refreshed on every `load`. Today this is empty for
  // every conversation because retry/replay still delete prior rows;
  // wired in so the moment that flips, the UI hides them automatically.
  supersededByConversation: Record<string, ReadonlySet<string>>;
  // UI-only: which user-row is currently in edit/replay mode (#44 + #47).
  // Per-conversation so switching chats doesn't reopen a stale editor.
  editingByConversation: Record<string, string | null>;
  replayQueue: Record<string, string[]>;
  setReplayQueue: (conversationId: string, queue: string[]) => void;
  popReplayQueue: (conversationId: string) => string | null;
  load: (conversationId: string) => Promise<void>;
  append: (m: Message) => void;
  patchContent: (conversationId: string, messageId: string, content: string) => void;
  patchError: (
    conversationId: string,
    messageId: string,
    errorMessage: string | null,
    errorTransient: boolean,
  ) => void;
  sendUserMessage: (args: {
    conversationId: string;
    content: string;
    addressedTo: string[];
    pinned?: boolean;
  }) => Promise<Message>;
  appendNotice: (conversationId: string, content: string) => Promise<Message>;
  setPinned: (conversationId: string, messageId: string, pinned: boolean) => Promise<void>;
  setEditing: (conversationId: string, messageId: string | null) => void;
}

export const useMessagesStore = create<State>((set, get) => ({
  supersededByConversation: {},
  editingByConversation: {},
  replayQueue: {},
  setReplayQueue(conversationId, queue) {
    set({ replayQueue: { ...get().replayQueue, [conversationId]: queue } });
  },
  popReplayQueue(conversationId) {
    const queue = get().replayQueue[conversationId] ?? [];
    if (queue.length === 0) return null;
    const [next, ...rest] = queue;
    set({ replayQueue: { ...get().replayQueue, [conversationId]: rest } });
    return next ?? null;
  },
  setEditing(conversationId, messageId) {
    set({
      editingByConversation: {
        ...get().editingByConversation,
        [conversationId]: messageId,
      },
    });
  },
  async load(conversationId) {
    const [list, superseded] = await Promise.all([
      repo.listMessages(conversationId),
      listSupersededMessageIds(conversationId),
    ]);
    cacheSet(conversationId, list);
    set({
      supersededByConversation: {
        ...get().supersededByConversation,
        [conversationId]: superseded,
      },
    });
  },
  append(m) {
    cacheUpdate(m.conversationId, (msgs) => [...msgs, m]);
  },
  patchContent(conversationId, messageId, content) {
    cacheUpdate(conversationId, (msgs) =>
      msgs.map((m) => (m.id === messageId ? { ...m, content } : m)),
    );
  },
  patchError(conversationId, messageId, errorMessage, errorTransient) {
    cacheUpdate(conversationId, (msgs) =>
      msgs.map((m) => (m.id === messageId ? { ...m, errorMessage, errorTransient } : m)),
    );
  },
  async sendUserMessage({ conversationId, content, addressedTo, pinned = false }) {
    const m = await repo.appendMessage({
      conversationId,
      role: "user",
      content,
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned,
      pinTarget: null,
      addressedTo,
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    get().append(m);
    return m;
  },
  async setPinned(conversationId, messageId, pinned) {
    const existing = cacheGet(conversationId);
    const target = existing.find((m) => m.id === messageId);
    if (!target) return;
    // Manual pins keep their addressedTo as the audience filter; we
    // do not write a single pinTarget for them. Identity pins (which
    // already have pinTarget set) keep theirs untouched on toggle.
    const pinTarget = target.pinTarget;
    await repo.setMessagePin(messageId, pinned, pinTarget);
    cacheUpdate(conversationId, (msgs) =>
      msgs.map((m) => (m.id === messageId ? { ...m, pinned } : m)),
    );
  },
  async appendNotice(conversationId, content) {
    const m = await repo.appendMessage({
      conversationId,
      role: "notice",
      content,
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    get().append(m);
    return m;
  },
}));
