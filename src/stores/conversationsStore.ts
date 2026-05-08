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
  // #291: thin pass-through read so components don't import
  // lib/persistence/conversations. Used as the loader inside
  // useRepoQuery (which manages the cache).
  listConversations: () => Promise<Conversation[]>;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  create: (init: Omit<Conversation, "id" | "createdAt">) => Promise<Conversation>;
  update: (c: Conversation) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  // #240: setLimit / setLimitSize removed alongside the //limit and
  // //limitsize commands.
  setDisplayMode: (id: string, mode: "lines" | "cols") => Promise<void>;
  setVisibilityMatrix: (id: string, matrix: Record<string, string[]>) => Promise<void>;
  // #279: cache-only update — caller has ALREADY written the matrix
  // to disk (typically via rebuildVisibilityFromPersonaDefaults). Used
  // to avoid the redundant updateConversation rewrite that
  // setVisibilityMatrix would otherwise issue (DELETE+INSERT on three
  // junction tables to update one column the rebuild already wrote).
  applyVisibilityMatrixCache: (id: string, matrix: Record<string, string[]>) => void;
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
  listConversations: () => repo.listConversations(),
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
    // #283: narrow setter — one UPDATE conversations.display_mode.
    await repo.setConversationDisplayMode(id, mode);
    cacheUpdate(replaceById({ ...current, displayMode: mode }));
  },
  async setVisibilityMatrix(id, matrix) {
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    const next: Conversation = { ...current, visibilityMatrix: matrix };
    await repo.updateConversation(next);
    cacheUpdate(replaceById(next));
  },
  applyVisibilityMatrixCache(id, matrix) {
    cacheUpdate((list) =>
      list.map((c) => (c.id === id ? { ...c, visibilityMatrix: matrix } : c)),
    );
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
    // #283: narrow setter — UPDATE conversations.autocompact_threshold
    // (+ DELETE conversation_context_warnings when turning ON). The
    // previous full updateConversation re-DELETE+INSERTed every
    // junction. Cache mirrors the same threshold-on-clears-warnings
    // semantic.
    await repo.setConversationAutocompact(id, threshold);
    const next: Conversation = {
      ...current,
      autocompactThreshold: threshold,
      contextWarningsFired: threshold ? [] : (current.contextWarningsFired ?? []),
    };
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
    // #283: narrow setter — one UPDATE conversations.flow_mode.
    await repo.setConversationFlowMode(id, on);
    cacheUpdate(replaceById({ ...current, flowMode: on }));
  },
  async rename(id, title) {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("Title cannot be empty");
    const current = cacheGet().find((c) => c.id === id);
    if (!current) return;
    // #283: narrow setter — one UPDATE conversations.title.
    await repo.setConversationTitle(id, trimmed);
    cacheUpdate(replaceById({ ...current, title: trimmed }));
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
