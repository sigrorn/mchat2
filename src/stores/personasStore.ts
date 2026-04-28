// ------------------------------------------------------------------
// Component: Personas store
// Responsibility: Per-conversation UI state for the persona selection
//                 (which persona keys are checked in the panel).
//                 Persistent persona data lives in repoQueryCache,
//                 not here (#211).
// Collaborators: personas/service.ts, persistence/personas.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { Persona } from "@/lib/types";
import * as repo from "@/lib/persistence/personas";
import { useConversationsStore } from "./conversationsStore";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";

const personasQueryKey = (conversationId: string): readonly unknown[] =>
  ["personas", conversationId];
function cacheUpdate(conversationId: string, fn: (list: Persona[]) => Persona[]): void {
  getRepoQueryCache().update<Persona[]>(personasQueryKey(conversationId), fn);
}
function cacheSet(conversationId: string, list: Persona[]): void {
  getRepoQueryCache().set<Persona[]>(personasQueryKey(conversationId), list);
}

interface State {
  selectionByConversation: Record<string, string[]>;
  load: (conversationId: string) => Promise<void>;
  setSelection: (conversationId: string, keys: string[]) => void;
  // Append-and-dedupe variant used by the create / import flows so a
  // freshly added persona is part of the next implicit send (#37).
  addToSelection: (conversationId: string, keys: string[]) => void;
  upsert: (p: Persona) => void;
  remove: (p: Persona) => void;
}

export const usePersonasStore = create<State>((set, get) => ({
  selectionByConversation: {},
  async load(conversationId) {
    const list = await repo.listPersonas(conversationId);
    cacheSet(conversationId, list);
    const conv = useConversationsStore
      .getState()
      .conversationsList()
      .find((c) => c.id === conversationId);
    if (conv && conv.selectedPersonas.length > 0) {
      const activeIds = new Set(list.map((p) => p.id));
      const valid = conv.selectedPersonas.filter((k) => activeIds.has(k));
      set({
        selectionByConversation: {
          ...get().selectionByConversation,
          [conversationId]: valid,
        },
      });
    }
  },
  setSelection(conversationId, keys) {
    set({
      selectionByConversation: {
        ...get().selectionByConversation,
        [conversationId]: keys,
      },
    });
    void useConversationsStore.getState().setSelectedPersonas(conversationId, keys);
  },
  addToSelection(conversationId, keys) {
    const current = get().selectionByConversation[conversationId] ?? [];
    const seen = new Set(current);
    const next = [...current];
    for (const k of keys) {
      if (!seen.has(k)) {
        next.push(k);
        seen.add(k);
      }
    }
    set({
      selectionByConversation: {
        ...get().selectionByConversation,
        [conversationId]: next,
      },
    });
    void useConversationsStore.getState().setSelectedPersonas(conversationId, next);
  },
  upsert(p) {
    cacheUpdate(p.conversationId, (list) => {
      const i = list.findIndex((x) => x.id === p.id);
      return i === -1 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x));
    });
  },
  remove(p) {
    cacheUpdate(p.conversationId, (list) => list.filter((x) => x.id !== p.id));
  },
}));
