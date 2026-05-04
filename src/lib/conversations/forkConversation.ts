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
import { serializeSnapshot, type SnapshotEnvelope } from "./snapshot";
import { parseSnapshot } from "../schemas/snapshot";
import { importSnapshot } from "./snapshotImport";

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

// Returns the Message.index of the Nth user message (1-indexed) in
// the source, or null if N exceeds the available user-message count.
// For null input ("keep everything"), returns past-the-end so every
// row passes the `m.index < cutAt` filter.
function computeCutAtIndex(
  messages: readonly Message[],
  userNumber: number | null,
): number | null {
  if (userNumber === null) {
    if (messages.length === 0) return 0;
    let max = -1;
    for (const m of messages) if (m.index > max) max = m.index;
    return max + 1;
  }
  let count = 0;
  for (const m of messages) {
    if (m.role === "user") {
      count++;
      if (count === userNumber) return m.index;
    }
  }
  return null;
}

export async function forkConversation(
  input: ForkConversationInput,
): Promise<Conversation> {
  const cutAt = computeCutAtIndex(input.sourceMessages, input.cutAtUserNumber);
  if (cutAt === null) {
    // userNumber out of range — caller surfaces this as an error notice.
    throw new ForkRangeError(
      `fork: user message ${input.cutAtUserNumber} does not exist in this conversation.`,
    );
  }

  // Filter live (non-superseded) messages strictly before the cut.
  const kept = [...input.sourceMessages]
    .filter((m) => m.supersededAt === null && m.index < cutAt)
    .sort((a, b) => a.index - b.index);

  // Build the envelope via the existing serializer — gives us free
  // id→name resolution for personas, flow steps, addressed_to, audience,
  // pin targets, role lens, and visibility matrix. We then mutate the
  // title and round-trip through parseSnapshot + importSnapshot to get
  // the same id-remapping the file-based path uses.
  const json = serializeSnapshot(
    input.source,
    input.sourcePersonas,
    kept,
    { flow: input.sourceFlow },
  );
  const envelope = JSON.parse(json) as SnapshotEnvelope;
  envelope.title = `Fork of ${input.source.title}`;

  // Drop the compaction floor when it points past the cut — would
  // otherwise pin a floor that doesn't correspond to anything in the
  // truncated history. (#240 removed the parallel limitMarkIndex
  // adjustment alongside the //limit command.)
  if (envelope.compactionFloorIndex !== null && envelope.compactionFloorIndex >= cutAt) {
    envelope.compactionFloorIndex = null;
  }

  // Re-validate via the snapshot schema so importSnapshot consumes a
  // shape that matches the public envelope (defensive — serialize
  // already produces a valid shape, but parseSnapshot is the single
  // entry point importSnapshot trusts).
  const reparsed = parseSnapshot(JSON.stringify(envelope));
  if (!reparsed.ok) {
    throw new Error(`fork: failed to build snapshot envelope (${reparsed.error})`);
  }
  const result = await importSnapshot(reparsed.snapshot);
  return result.conversation;
}
