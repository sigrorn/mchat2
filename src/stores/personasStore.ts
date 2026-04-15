// ------------------------------------------------------------------
// Component: Personas store
// Responsibility: Per-conversation persona list + current selection
//                 (persona keys) used by the resolver in 'implicit' /
//                 'others' modes.
// Collaborators: personas/service.ts, persistence/personas.ts.
// ------------------------------------------------------------------

import { create } from "zustand";
import type { Persona } from "@/lib/types";
import * as repo from "@/lib/persistence/personas";

interface State {
  byConversation: Record<string, Persona[]>;
  selectionByConversation: Record<string, string[]>;
  load: (conversationId: string) => Promise<void>;
  setSelection: (conversationId: string, keys: string[]) => void;
  upsert: (p: Persona) => void;
  remove: (p: Persona) => void;
}

export const usePersonasStore = create<State>((set, get) => ({
  byConversation: {},
  selectionByConversation: {},
  async load(conversationId) {
    const list = await repo.listPersonas(conversationId);
    set({
      byConversation: { ...get().byConversation, [conversationId]: list },
    });
  },
  setSelection(conversationId, keys) {
    set({
      selectionByConversation: {
        ...get().selectionByConversation,
        [conversationId]: keys,
      },
    });
  },
  upsert(p) {
    const existing = get().byConversation[p.conversationId] ?? [];
    const idx = existing.findIndex((x) => x.id === p.id);
    const next = idx === -1 ? [...existing, p] : existing.map((x) => (x.id === p.id ? p : x));
    set({
      byConversation: { ...get().byConversation, [p.conversationId]: next },
    });
  },
  remove(p) {
    const existing = get().byConversation[p.conversationId] ?? [];
    set({
      byConversation: {
        ...get().byConversation,
        [p.conversationId]: existing.filter((x) => x.id !== p.id),
      },
    });
  },
}));
