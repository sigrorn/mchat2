// flowsRepo round-trips per-step instruction (#230).
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

describe("flowsRepo step instruction (#230)", () => {
  it("defaults instruction to null when omitted", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(f.steps[0]?.instruction).toBeNull();
    expect(f.steps[1]?.instruction).toBeNull();
  });

  it("persists a non-empty instruction through upsert + reread", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        {
          kind: "personas",
          personaIds: ["p_a"],
          instruction: "Focus on the economic angle for this round.",
        },
      ],
    });
    expect(f.steps[1]?.instruction).toBe(
      "Focus on the economic angle for this round.",
    );
    const reread = await flowsRepo.getFlow("c_1");
    expect(reread?.steps[1]?.instruction).toBe(
      "Focus on the economic angle for this round.",
    );
  });

  it("treats empty string the same as null (no instruction)", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"], instruction: "" },
      ],
    });
    expect(f.steps[1]?.instruction).toBeNull();
  });

  it("clears the instruction on a second upsert that omits it", async () => {
    await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"], instruction: "round 1 note" },
      ],
    });
    const updated = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(updated.steps[1]?.instruction).toBeNull();
  });
});
