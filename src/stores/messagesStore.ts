// ------------------------------------------------------------------
// Component: Messages store
// Responsibility: Per-conversation message list. Supports in-place
//                 updates for streaming tokens so React renders one
//                 bubble growing instead of a new array each token.
// Collaborators: persistence/messages.ts, orchestration/streamRunner.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { Message } from "@/lib/types";
import * as repo from "@/lib/persistence/messages";

interface State {
  byConversation: Record<string, Message[]>;
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
}

export const useMessagesStore = create<State>((set, get) => ({
  byConversation: {},
  async load(conversationId) {
    const list = await repo.listMessages(conversationId);
    set({ byConversation: { ...get().byConversation, [conversationId]: list } });
  },
  append(m) {
    const existing = get().byConversation[m.conversationId] ?? [];
    set({
      byConversation: {
        ...get().byConversation,
        [m.conversationId]: [...existing, m],
      },
    });
  },
  patchContent(conversationId, messageId, content) {
    const existing = get().byConversation[conversationId] ?? [];
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: existing.map((m) => (m.id === messageId ? { ...m, content } : m)),
      },
    });
  },
  patchError(conversationId, messageId, errorMessage, errorTransient) {
    const existing = get().byConversation[conversationId] ?? [];
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: existing.map((m) =>
          m.id === messageId ? { ...m, errorMessage, errorTransient } : m,
        ),
      },
    });
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
    const existing = get().byConversation[conversationId] ?? [];
    const target = existing.find((m) => m.id === messageId);
    if (!target) return;
    // Manual pins keep their addressedTo as the audience filter; we
    // do not write a single pinTarget for them. Identity pins (which
    // already have pinTarget set) keep theirs untouched on toggle.
    const pinTarget = target.pinTarget;
    await repo.setMessagePin(messageId, pinned, pinTarget);
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: existing.map((m) => (m.id === messageId ? { ...m, pinned } : m)),
      },
    });
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
