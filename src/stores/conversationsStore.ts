// ------------------------------------------------------------------
// Component: Conversations store
// Responsibility: Reactive list + selection. Every mutation goes
//                 through conversationsRepo; the store only caches.
// Collaborators: persistence/conversations.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { AutocompactThreshold, Conversation } from "@/lib/types";
import * as repo from "@/lib/persistence/conversations";

interface State {
  conversations: Conversation[];
  currentId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  create: (init: Omit<Conversation, "id" | "createdAt">) => Promise<Conversation>;
  update: (c: Conversation) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  setLimit: (id: string, limitMarkIndex: number | null) => Promise<void>;
  setDisplayMode: (id: string, mode: "lines" | "cols") => Promise<void>;
  setVisibilityMatrix: (id: string, matrix: Record<string, string[]>) => Promise<void>;
  setVisibilityPreset: (
    id: string,
    mode: "separated" | "joined",
    personaIds: string[],
  ) => Promise<void>;
  setLimitSize: (id: string, limitSizeTokens: number | null) => Promise<void>;
  setSelectedPersonas: (id: string, keys: string[]) => Promise<void>;
  setCompactionFloor: (id: string, floorIndex: number | null) => Promise<void>;
  setAutocompact: (id: string, threshold: AutocompactThreshold | null) => Promise<void>;
  setContextWarningsFired: (id: string, fired: number[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useConversationsStore = create<State>((set, get) => ({
  conversations: [],
  currentId: null,
  loaded: false,
  async load() {
    const list = await repo.listConversations();
    set({ conversations: list, loaded: true });
  },
  select(id) {
    set({ currentId: id });
  },
  async create(init) {
    const c = await repo.createConversation(init);
    set({ conversations: [c, ...get().conversations], currentId: c.id });
    return c;
  },
  async update(c) {
    await repo.updateConversation(c);
    set({
      conversations: get().conversations.map((x) => (x.id === c.id ? c : x)),
    });
  },
  async setDisplayMode(id, mode) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, displayMode: mode };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setVisibilityMatrix(id, matrix) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, visibilityMatrix: matrix };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setVisibilityPreset(id, mode, personaIds) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const matrix: Record<string, string[]> =
      mode === "separated" ? Object.fromEntries(personaIds.map((pid) => [pid, []])) : {};
    const next: Conversation = {
      ...current,
      visibilityMode: mode,
      visibilityMatrix: matrix,
    };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setLimitSize(id, limitSizeTokens) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, limitSizeTokens };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setSelectedPersonas(id, keys) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, selectedPersonas: keys };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setCompactionFloor(id, floorIndex) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, compactionFloorIndex: floorIndex };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setAutocompact(id, threshold) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = {
      ...current,
      autocompactThreshold: threshold,
      // Reset warning flags when turning autocompact on.
      contextWarningsFired: threshold ? [] : (current.contextWarningsFired ?? []),
    };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setContextWarningsFired(id, fired) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, contextWarningsFired: fired };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async setLimit(id, limitMarkIndex) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, limitMarkIndex };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async rename(id, title) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title cannot be empty");
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, title: trimmed };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
  },
  async remove(id) {
    await repo.deleteConversation(id);
    set({
      conversations: get().conversations.filter((x) => x.id !== id),
      currentId: get().currentId === id ? null : get().currentId,
    });
  },
}));
