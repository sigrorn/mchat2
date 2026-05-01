// flowsRepo round-trips loopStartIndex (#220).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import * as flowsRepo from "@/lib/persistence/flows";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations
      (id, title, created_at, display_mode, visibility_mode,
       visibility_matrix, selected_personas, context_warnings_fired)
      VALUES ('c_1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
  );
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug,
      created_at_message_index, sort_order, visibility_defaults, role_lens)
      VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '{}', '{}')`,
  );
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("flowsRepo loopStartIndex (#220)", () => {
  it("defaults loopStartIndex to 0 when omitted", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(f.loopStartIndex).toBe(0);
  });

  it("persists a non-zero loopStartIndex through upsert + reread", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      loopStartIndex: 2,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(f.loopStartIndex).toBe(2);
    const reread = await flowsRepo.getFlow("c_1");
    expect(reread?.loopStartIndex).toBe(2);
  });

  it("rejects loopStartIndex outside [0, steps.length)", async () => {
    await expect(
      flowsRepo.upsertFlow("c_1", {
        currentStepIndex: 0,
        loopStartIndex: 5,
        steps: [{ kind: "user", personaIds: [] }],
      }),
    ).rejects.toThrow();
    await expect(
      flowsRepo.upsertFlow("c_1", {
        currentStepIndex: 0,
        loopStartIndex: -1,
        steps: [{ kind: "user", personaIds: [] }],
      }),
    ).rejects.toThrow();
  });

  it("preserves loopStartIndex across a second upsert that omits the field", async () => {
    // Convention: the FlowDraft passes the field explicitly. Omitting
    // (undefined) re-defaults to 0, which is the documented behaviour.
    // This pin documents that contract so future refactors don't
    // accidentally make omit-means-keep.
    await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      loopStartIndex: 1,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    const updated = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 1,
      // loopStartIndex omitted — should reset to 0.
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(updated.loopStartIndex).toBe(0);
  });
});
