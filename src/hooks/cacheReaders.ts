// ------------------------------------------------------------------
// Component: cacheReaders
// Responsibility: Synchronous accessors for entities that the deps
//                 factories (commandDeps, runOneTargetDeps,
//                 postResponseCheckDeps) need to read from inside
//                 use-case code that runs outside React's render
//                 pass. After #211 the stores no longer hold these
//                 entities; the cache is the single source of truth.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "@/lib/types";
import { getRepoQueryCache } from "@/lib/data/useRepoQuery";

const EMPTY_M: readonly Message[] = Object.freeze([]) as readonly Message[];
const EMPTY_P: readonly Persona[] = Object.freeze([]) as readonly Persona[];
const EMPTY_C: readonly Conversation[] = Object.freeze([]) as readonly Conversation[];

export function readCachedMessages(conversationId: string): readonly Message[] {
  return getRepoQueryCache().get<readonly Message[]>(["messages", conversationId]) ?? EMPTY_M;
}

export function readCachedPersonas(conversationId: string): readonly Persona[] {
  return getRepoQueryCache().get<readonly Persona[]>(["personas", conversationId]) ?? EMPTY_P;
}

export function readCachedConversations(): readonly Conversation[] {
  return getRepoQueryCache().get<readonly Conversation[]>(["conversations"]) ?? EMPTY_C;
}
