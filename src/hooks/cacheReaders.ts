// ------------------------------------------------------------------
// Component: cacheReaders
// Responsibility: Synchronous accessors for entities that the deps
//                 factories (commandDeps, runOneTargetDeps,
//                 postResponseCheckDeps) need to read from inside
//                 use-case code that runs outside React's render
//                 pass. Reads from repoQueryCache.get(); falls back
//                 to the legacy Zustand mirror for cold-start cases
//                 where the cache hasn't been populated yet.
// Migration:    Step 1 of #211. The fallback to store.getState()
//                 .byConversation[id] is removed in step 3 once the
//                 stores stop holding persistent-mirror state.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "@/lib/types";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";

const EMPTY_M: readonly Message[] = Object.freeze([]) as readonly Message[];
const EMPTY_P: readonly Persona[] = Object.freeze([]) as readonly Persona[];
const EMPTY_C: readonly Conversation[] = Object.freeze([]) as readonly Conversation[];

export function readCachedMessages(conversationId: string): readonly Message[] {
  const cached = getRepoQueryCache().get<readonly Message[]>(["messages", conversationId]);
  if (cached) return cached;
  return useMessagesStore.getState().byConversation[conversationId] ?? EMPTY_M;
}

export function readCachedPersonas(conversationId: string): readonly Persona[] {
  const cached = getRepoQueryCache().get<readonly Persona[]>(["personas", conversationId]);
  if (cached) return cached;
  return usePersonasStore.getState().byConversation[conversationId] ?? EMPTY_P;
}

export function readCachedConversations(): readonly Conversation[] {
  const cached = getRepoQueryCache().get<readonly Conversation[]>(["conversations"]);
  if (cached) return cached;
  return useConversationsStore.getState().conversations ?? EMPTY_C;
}
