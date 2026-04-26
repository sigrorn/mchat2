// ------------------------------------------------------------------
// Component: Conversations store
// Responsibility: Reactive list + selection. Every mutation goes
//                 through conversationsRepo; the store only caches.
// Collaborators: persistence/conversations.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { AutocompactThreshold, Conversation } from "@/lib/types";
import * as repo from "@/lib/persistence/conversations";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";

// #186: dual-write helpers for the data layer. Conversations is a
// flat list keyed by ['conversations']. Mirrors the patterns from
// #184 / #185.
const CONVERSATIONS_KEY: readonly unknown[] = ["conversations"];
function cacheUpdate(fn: (list: Conversation[]) => Conversation[]): void {
  getRepoQueryCache().update<Conversation[]>(CONVERSATIONS_KEY, fn);
}
function cacheSet(list: Conversation[]): void {
  getRepoQueryCache().set<Conversation[]>(CONVERSATIONS_KEY, list);
}
// Most mutations boil down to "replace the row with the same id".
function replaceById(c: Conversation): (list: Conversation[]) => Conversation[] {
  return (list) => list.map((x) => (x.id === c.id ? c : x));
}

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
    cacheSet(list);
  },
  select(id) {
    set({ currentId: id });
  },
  async create(init) {
    const c = await repo.createConversation(init);
    set({ conversations: [c, ...get().conversations], currentId: c.id });
    cacheUpdate((list) => [c, ...list]);
    return c;
  },
  async update(c) {
    await repo.updateConversation(c);
    set({
      conversations: get().conversations.map((x) => (x.id === c.id ? c : x)),
    });
    cacheUpdate(replaceById(c));
  },
  async setDisplayMode(id, mode) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, displayMode: mode };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
  },
  async setVisibilityMatrix(id, matrix) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, visibilityMatrix: matrix };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
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
    cacheUpdate(replaceById(next));
  },
  async setLimitSize(id, limitSizeTokens) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, limitSizeTokens };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
  },
  async setSelectedPersonas(id, keys) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, selectedPersonas: keys };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
  },
  async setCompactionFloor(id, floorIndex) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, compactionFloorIndex: floorIndex };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
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
    cacheUpdate(replaceById(next));
  },
  async setContextWarningsFired(id, fired) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, contextWarningsFired: fired };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
  },
  async setLimit(id, limitMarkIndex) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, limitMarkIndex };
    await repo.updateConversation(next);
    set({
      conversations: get().conversations.map((x) => (x.id === id ? next : x)),
    });
    cacheUpdate(replaceById(next));
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
    cacheUpdate(replaceById(next));
  },
  async remove(id) {
    await repo.deleteConversation(id);
    set({
      conversations: get().conversations.filter((x) => x.id !== id),
      currentId: get().currentId === id ? null : get().currentId,
    });
    cacheUpdate((list) => list.filter((x) => x.id !== id));
  },
}));
