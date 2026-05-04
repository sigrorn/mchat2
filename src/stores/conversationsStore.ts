// ------------------------------------------------------------------
// Component: Conversations store
// Responsibility: UI selection (currentId) + bootstrap flag, plus
//                 the action API that mutates conversations through
//                 the repo + cache. The persistent list itself lives
//                 in repoQueryCache, not here (#211).
// Collaborators: persistence/conversations.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { AutocompactThreshold, Conversation } from "@/lib/types";
import * as repo from "@/lib/persistence/conversations";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";

const CONVERSATIONS_KEY: readonly unknown[] = ["conversations"];
function cacheUpdate(fn: (list: Conversation[]) => Conversation[]): void {
  getRepoQueryCache().update<Conversation[]>(CONVERSATIONS_KEY, fn);
}
function cacheSet(list: Conversation[]): void {
  getRepoQueryCache().set<Conversation[]>(CONVERSATIONS_KEY, list);
}
function cacheGet(): Conversation[] {
  return getRepoQueryCache().get<Conversation[]>(CONVERSATIONS_KEY) ?? [];
}
// Most mutations boil down to "replace the row with the same id".
function replaceById(c: Conversation): (list: Conversation[]) => Conversation[] {
  return (list) => list.map((x) => (x.id === c.id ? c : x));
}

interface State {
  currentId: string | null;
  loaded: boolean;
  // Synchronous accessor for callers (orchestration, deps factories,
  // cross-store reads in personasStore.load) that need the current
  // conversation list outside React's render path.
  conversationsList: () => Conversation[];
  load: () => Promise<void>;
  select: (id: string | null) => void;
  create: (init: Omit<Conversation, "id" | "createdAt">) => Promise<Conversation>;
  update: (c: Conversation) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  // #240: setLimit / setLimitSize removed alongside the //limit and
  // //limitsize commands.
  setDisplayMode: (id: string, mode: "lines" | "cols") => Promise<void>;
  setVisibilityMatrix: (id: string, matrix: Record<string, string[]>) => Promise<void>;
  setVisibilityPreset: (
    id: string,
    mode: "separated" | "joined",
    personaIds: string[],
  ) => Promise<void>;
  setSelectedPersonas: (id: string, keys: string[]) => Promise<void>;
  setCompactionFloor: (id: string, floorIndex: number | null) => Promise<void>;
  setAutocompact: (id: string, threshold: AutocompactThreshold | null) => Promise<void>;
  setContextWarningsFired: (id: string, fired: number[]) => Promise<void>;
  setFlowMode: (id: string, on: boolean) => Promise<void>;
  // #250: stamp the conversation's last_seen_at to clear its sidebar
  // unread dot. Called from ChatView when the conversation becomes
  // active and after appendMessage/patches land in the active one.
  markSeen: (id: string, ts: number) => Promise<void>;
  // #250: refresh the cached conversation row from DB. The
  // appendMessage path bumps last_message_at directly via SQL so
  // every code path that creates messages updates the column without
  // routing through the store; the store mirrors that bump back into
  // the cache so the sidebar's hasUnread re-renders.
  refreshLastMessageAt: (id: string, ts: number) => void;
  remove: (id: string) => Promise<void>;
}

export const useConversationsStore = create<State>((set, get) => ({
  currentId: null,
  loaded: false,
  conversationsList: () => cacheGet(),
  async load() {
    const list = await repo.listConversations();
    cacheSet(list);
    set({ loaded: true });
  },
  select(id) {
    set({ currentId: id });
  },
  async create(init) {
    const c = await repo.createConversation(init);
    cacheUpdate((list) => [c, ...list]);
    set({ currentId: c.id });
    return c;
  },
  async update(c) {
    await repo.updateConversation(c);
    cacheUpdate(replaceById(c));
  },
  async setDisplayMode(id, mode) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, displayMode: mode };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setVisibilityMatrix(id, matrix) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, visibilityMatrix: matrix };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setVisibilityPreset(id, mode, personaIds) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const matrix: Record<string, string[]> =
      mode === "separated" ? Object.fromEntries(personaIds.map((pid) => [pid, []])) : {};
    const next: Conversation = {
      ...current,
      visibilityMode: mode,
      visibilityMatrix: matrix,
    };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setSelectedPersonas(id, keys) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, selectedPersonas: keys };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setCompactionFloor(id, floorIndex) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, compactionFloorIndex: floorIndex };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setAutocompact(id, threshold) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = {
      ...current,
      autocompactThreshold: threshold,
      // Reset warning flags when turning autocompact on.
      contextWarningsFired: threshold ? [] : (current.contextWarningsFired ?? []),
    };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setContextWarningsFired(id, fired) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, contextWarningsFired: fired };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async setFlowMode(id, on) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    if ((current.flowMode ?? false) === on) return; // no-op
    const next: Conversation = { ...current, flowMode: on };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async rename(id, title) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title cannot be empty");
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, title: trimmed };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  async markSeen(id, ts) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    if ((current.lastSeenAt ?? 0) >= ts) return; // monotonic — never go backwards
    const next: Conversation = { ...current, lastSeenAt: ts };
    await repo.setLastSeen(id, ts);
    cacheUpdate(replaceById(next));
  },
  refreshLastMessageAt(id, ts) {
    cacheUpdate((list) =>
      list.map((c) => (c.id === id && (c.lastMessageAt ?? 0) < ts ? { ...c, lastMessageAt: ts } : c)),
    );
  },
  async remove(id) {
    await repo.deleteConversation(id);
    cacheUpdate((list) => list.filter((x) => x.id !== id));
    if (get().currentId === id) set({ currentId: null });
  },
}));
