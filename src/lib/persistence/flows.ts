// ------------------------------------------------------------------
// Component: Flows repository (#215, slice 3 of #212)
// Responsibility: CRUD over the flow / flow_steps / flow_step_personas
//                 tables. Service-layer validation rejects empty
//                 `personas` steps and consecutive `user` steps —
//                 invariants buildContext + the editor would otherwise
//                 hit at run time.
// Collaborators: lib/types/flow, lib/flows/derivation,
//                lib/app/sendMessage (cursor advancement, slice 5).
// ------------------------------------------------------------------

import type { Kysely } from "kysely";
import { db } from "./db";
import type { Database } from "./schema";
import type { Flow, FlowDraft, FlowStep } from "../types/flow";

// #267: see lib/persistence/messages.ts header note about the
// optional Kysely arg threaded through repos called inside
// transactions. upsertFlow + getFlow are reachable from
// fileOps's persona import transaction.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
function randId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}
const newFlowId = (): string => `flow_${randId(10)}`;
const newStepId = (): string => `fs_${randId(10)}`;

export async function getFlow(
  conversationId: string,
  dbi: Kysely<Database> = db,
): Promise<Flow | null> {
  const flowRow = await dbi
    .selectFrom("flows")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .executeTakeFirst();
  if (!flowRow) return null;
  const stepRows = await dbi
    .selectFrom("flow_steps")
    .selectAll()
    .where("flow_id", "=", flowRow.id)
    .orderBy("sequence")
    .execute();
  const stepIds = stepRows.map((s) => s.id);
  const personaRows =
    stepIds.length === 0
      ? []
      : await dbi
          .selectFrom("flow_step_personas")
          .selectAll()
          .where("flow_step_id", "in", stepIds)
          .execute();
  const byStep = new Map<string, string[]>();
  for (const id of stepIds) byStep.set(id, []);
  for (const r of personaRows) byStep.get(r.flow_step_id)?.push(r.persona_id);
  const steps: FlowStep[] = stepRows.map((r) => ({
    id: r.id,
    flowId: r.flow_id,
    sequence: r.sequence,
    kind: r.kind === "user" ? "user" : "personas",
    personaIds: byStep.get(r.id) ?? [],
    instruction: r.instruction ?? null,
  }));
  return {
    id: flowRow.id,
    conversationId: flowRow.conversation_id,
    currentStepIndex: flowRow.current_step_index,
    loopStartIndex: flowRow.loop_start_index,
    steps,
  };
}

function validateDraft(draft: FlowDraft): void {
  for (let i = 0; i < draft.steps.length; i++) {
    const s = draft.steps[i]!;
    if (s.kind === "personas" && s.personaIds.length === 0) {
      throw new Error(`flow step ${i}: 'personas' step with no personas`);
    }
    if (i > 0 && s.kind === "user" && draft.steps[i - 1]?.kind === "user") {
      throw new Error(`flow step ${i}: consecutive 'user' steps`);
    }
  }
  // #220: loopStartIndex must point at a real step. Empty flows are
  // allowed (no cycle yet) — loopStartIndex is meaningless and we
  // accept any value (the upsert below will store 0).
  if (draft.steps.length > 0 && draft.loopStartIndex !== undefined) {
    if (
      draft.loopStartIndex < 0 ||
      draft.loopStartIndex >= draft.steps.length ||
      !Number.isInteger(draft.loopStartIndex)
    ) {
      throw new Error(
        `flow.loopStartIndex out of range: ${draft.loopStartIndex} (steps: ${draft.steps.length})`,
      );
    }
  }
}

export async function upsertFlow(
  conversationId: string,
  draft: FlowDraft,
  dbi: Kysely<Database> = db,
): Promise<Flow> {
  validateDraft(draft);

  const existing = await dbi
    .selectFrom("flows")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .executeTakeFirst();

  const flowId = existing?.id ?? newFlowId();
  const loopStart = draft.loopStartIndex ?? 0;

  if (existing) {
    await dbi
      .updateTable("flows")
      .set({
        current_step_index: draft.currentStepIndex,
        loop_start_index: loopStart,
      })
      .where("id", "=", flowId)
      .execute();
    // CASCADE deletes step rows + step-persona junction rows.
    await dbi.deleteFrom("flow_steps").where("flow_id", "=", flowId).execute();
  } else {
    await dbi
      .insertInto("flows")
      .values({
        id: flowId,
        conversation_id: conversationId,
        current_step_index: draft.currentStepIndex,
        loop_start_index: loopStart,
      })
      .execute();
  }

  for (let i = 0; i < draft.steps.length; i++) {
    const s = draft.steps[i]!;
    const stepId = newStepId();
    // #230: empty-string instruction normalises to NULL — keeps the
    // disk shape clean (a blank textbox shouldn't persist as a row
    // with an empty hidden note).
    const trimmedInstruction = s.instruction?.trim();
    const instructionToStore = trimmedInstruction ? trimmedInstruction : null;
    await dbi
      .insertInto("flow_steps")
      .values({
        id: stepId,
        flow_id: flowId,
        sequence: i,
        kind: s.kind,
        instruction: instructionToStore,
      })
      .execute();
    if (s.personaIds.length > 0) {
      await dbi
        .insertInto("flow_step_personas")
        .values(
          s.personaIds.map((pid) => ({
            flow_step_id: stepId,
            persona_id: pid,
          })),
        )
        .execute();
    }
  }

  const fresh = await getFlow(conversationId, dbi);
  if (!fresh) throw new Error("upsertFlow: failed to read back persisted flow");
  return fresh;
}

export async function setStepIndex(flowId: string, index: number): Promise<void> {
  await db
    .updateTable("flows")
    .set({ current_step_index: index })
    .where("id", "=", flowId)
    .execute();
}

export async function deleteFlow(conversationId: string): Promise<void> {
  await db
    .deleteFrom("flows")
    .where("conversation_id", "=", conversationId)
    .execute();
}
