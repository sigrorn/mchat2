// ------------------------------------------------------------------
// Component: RepoContext
// Responsibility: Bundle the transaction-relevant repo functions
//                 pre-bound to a specific Kysely<Database> instance.
//                 Layered ON TOP of the optional-`dbi` pattern from
//                 ADR 011: the bundle's methods just thread the
//                 captured impl into the existing repo functions.
//
//                 The structural benefit: inside a transaction body,
//                 callers reach for `const repos = reposFor(txn.db)`
//                 and call `repos.messages.foo(args)` — they cannot
//                 accidentally reach the global db, because the
//                 binding is captured in the bundle, not threaded
//                 manually per call. Forgetting a thread now becomes
//                 a type error (no `.foo(args, txn.db)` overload to
//                 forget).
//
// Collaborators: every transaction body (history.ts //pop,
//                replayMessage.ts, fileOps.ts, snapshotImport.ts,
//                runCompactionCommit.ts).
// History:       Added in #272 as the structural successor to ADR
//                011's optional-dbi pattern. The optional args remain
//                on each repo function for now — non-transaction
//                callers can keep `import * as messagesRepo` without
//                churn. A future cleanup may drop the optional dbi
//                from repo signatures once every transaction site
//                has migrated to RepoContext.
// ------------------------------------------------------------------

import type { Kysely } from "kysely";
import type { Database } from "./schema";
import * as messagesRepo from "./messages";
import * as personasRepo from "./personas";
import * as conversationsRepo from "./conversations";
import * as flowsRepo from "./flows";

export interface MessagesRepoCtx {
  appendMessage: (
    partial: Parameters<typeof messagesRepo.appendMessage>[0],
  ) => ReturnType<typeof messagesRepo.appendMessage>;
  bulkAppendMessages: (
    conversationId: Parameters<typeof messagesRepo.bulkAppendMessages>[0],
    partials: Parameters<typeof messagesRepo.bulkAppendMessages>[1],
  ) => ReturnType<typeof messagesRepo.bulkAppendMessages>;
  applyMessageMutation: (
    mutation: Parameters<typeof messagesRepo.applyMessageMutation>[0],
  ) => ReturnType<typeof messagesRepo.applyMessageMutation>;
  insertMessageAtIndex: (
    partial: Parameters<typeof messagesRepo.insertMessageAtIndex>[0],
  ) => ReturnType<typeof messagesRepo.insertMessageAtIndex>;
  shiftMessageIndicesFrom: (
    conversationId: string,
    fromIdx: number,
    delta: number,
  ) => ReturnType<typeof messagesRepo.shiftMessageIndicesFrom>;
  deleteMessagesAfter: (
    conversationId: string,
    index: number,
  ) => ReturnType<typeof messagesRepo.deleteMessagesAfter>;
  updateMessageContent: (
    id: string,
    content: string,
    errorMessage: string | null,
    errorTransient: boolean,
  ) => ReturnType<typeof messagesRepo.updateMessageContent>;
  finalizeAssistantMessage: (
    id: Parameters<typeof messagesRepo.finalizeAssistantMessage>[0],
    state: Parameters<typeof messagesRepo.finalizeAssistantMessage>[1],
  ) => ReturnType<typeof messagesRepo.finalizeAssistantMessage>;
  markMessagesSuperseded: (
    ids: readonly string[],
    at: number,
  ) => ReturnType<typeof messagesRepo.markMessagesSuperseded>;
  listMessages: (
    conversationId: string,
  ) => ReturnType<typeof messagesRepo.listMessages>;
}

export interface PersonasRepoCtx {
  listPersonas: (
    conversationId: string,
    includeTombstones?: boolean,
  ) => ReturnType<typeof personasRepo.listPersonas>;
  getPersona: (
    id: string,
  ) => ReturnType<typeof personasRepo.getPersona>;
  createPersona: (
    partial: Parameters<typeof personasRepo.createPersona>[0],
  ) => ReturnType<typeof personasRepo.createPersona>;
  updatePersona: (
    p: Parameters<typeof personasRepo.updatePersona>[0],
  ) => ReturnType<typeof personasRepo.updatePersona>;
}

export interface ConversationsRepoCtx {
  createConversation: (
    partial: Parameters<typeof conversationsRepo.createConversation>[0],
  ) => ReturnType<typeof conversationsRepo.createConversation>;
  updateConversation: (
    conv: Parameters<typeof conversationsRepo.updateConversation>[0],
  ) => ReturnType<typeof conversationsRepo.updateConversation>;
  setCompactionFloor: (
    conversationId: string,
    floorIndex: number | null,
  ) => ReturnType<typeof conversationsRepo.setCompactionFloor>;
  writeVisibilityMatrix: (
    conversationId: string,
    matrix: Record<string, string[]>,
  ) => ReturnType<typeof conversationsRepo.writeVisibilityMatrix>;
}

export interface FlowsRepoCtx {
  getFlow: (
    conversationId: string,
  ) => ReturnType<typeof flowsRepo.getFlow>;
  upsertFlow: (
    conversationId: string,
    draft: Parameters<typeof flowsRepo.upsertFlow>[1],
  ) => ReturnType<typeof flowsRepo.upsertFlow>;
}

export interface RepoContext {
  readonly messages: MessagesRepoCtx;
  readonly personas: PersonasRepoCtx;
  readonly conversations: ConversationsRepoCtx;
  readonly flows: FlowsRepoCtx;
}

/**
 * Build a RepoContext bundle bound to a specific Kysely impl. Inside
 * a transaction body: `const repos = reposFor(txn.db)`. Outside:
 * `const repos = reposFor(db)` for the global-bound flavour.
 *
 * The bundle's methods are thin shims over the existing optional-dbi
 * repo functions — there's no behavior change, only a different
 * caller-side ergonomic.
 */
export function reposFor(dbi: Kysely<Database>): RepoContext {
  return {
    messages: {
      appendMessage: (partial) => messagesRepo.appendMessage(partial, dbi),
      bulkAppendMessages: (conversationId, partials) =>
        messagesRepo.bulkAppendMessages(conversationId, partials, dbi),
      applyMessageMutation: (mutation) =>
        messagesRepo.applyMessageMutation(mutation, dbi),
      insertMessageAtIndex: (partial) =>
        messagesRepo.insertMessageAtIndex(partial, dbi),
      shiftMessageIndicesFrom: (conversationId, fromIdx, delta) =>
        messagesRepo.shiftMessageIndicesFrom(conversationId, fromIdx, delta, dbi),
      deleteMessagesAfter: (conversationId, index) =>
        messagesRepo.deleteMessagesAfter(conversationId, index, dbi),
      updateMessageContent: (id, content, errorMessage, errorTransient) =>
        messagesRepo.updateMessageContent(id, content, errorMessage, errorTransient, dbi),
      finalizeAssistantMessage: (id, state) =>
        messagesRepo.finalizeAssistantMessage(id, state, dbi),
      markMessagesSuperseded: (ids, at) =>
        messagesRepo.markMessagesSuperseded(ids, at, dbi),
      listMessages: (conversationId) =>
        messagesRepo.listMessages(conversationId, dbi),
    },
    personas: {
      listPersonas: (conversationId, includeTombstones) =>
        personasRepo.listPersonas(conversationId, includeTombstones, dbi),
      getPersona: (id) => personasRepo.getPersona(id, dbi),
      createPersona: (partial) => personasRepo.createPersona(partial, dbi),
      updatePersona: (p) => personasRepo.updatePersona(p, dbi),
    },
    conversations: {
      createConversation: (partial) =>
        conversationsRepo.createConversation(partial, dbi),
      updateConversation: (conv) =>
        conversationsRepo.updateConversation(conv, dbi),
      setCompactionFloor: (conversationId, floorIndex) =>
        conversationsRepo.setCompactionFloor(conversationId, floorIndex, dbi),
      writeVisibilityMatrix: (conversationId, matrix) =>
        conversationsRepo.writeVisibilityMatrix(conversationId, matrix, dbi),
    },
    flows: {
      getFlow: (conversationId) => flowsRepo.getFlow(conversationId, dbi),
      upsertFlow: (conversationId, draft) =>
        flowsRepo.upsertFlow(conversationId, draft, dbi),
    },
  };
}
