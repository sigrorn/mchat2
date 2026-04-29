// ------------------------------------------------------------------
// Component: forkConversation use case (#224)
// Responsibility: Branch a conversation from a specific user message —
//                 implements the //fork [N] command. Builds a snapshot
//                 envelope from the source (truncated to the kept
//                 message range) and delegates to importSnapshot for
//                 the persona/flow id-remapping pipeline.
// Collaborators: lib/conversations/snapshot, lib/conversations/snapshotImport,
//                lib/commands/handlers/fork.
// ------------------------------------------------------------------

import type { Conversation, Flow, Message, Persona } from "../types";

export class ForkRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkRangeError";
  }
}

export interface ForkConversationInput {
  source: Conversation;
  sourcePersonas: readonly Persona[];
  sourceMessages: readonly Message[];
  sourceFlow: Flow | null;
  // null → keep all currently-persisted messages (//fork no-arg).
  // N → keep everything strictly before user message N (1-indexed).
  cutAtUserNumber: number | null;
}

export async function forkConversation(
  _input: ForkConversationInput,
): Promise<Conversation> {
  // Stub — implementation lands in the impl commit per the test-first
  // workflow. Throwing here makes the use-case tests fail with a clear
  // signal until the real logic lands.
  throw new Error("forkConversation: not implemented");
}
