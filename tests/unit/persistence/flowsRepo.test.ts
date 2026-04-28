// flowsRepo CRUD — slice 3 of #212 (#215).
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
      created_at_message_index, sort_order, runs_after, visibility_defaults, role_lens)
      VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}', '{}'),
             ('p_b', 'c_1', 'mock', 'B', 'b', 0, 1, '[]', '{}', '{}')`,
  );
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("flowsRepo", () => {
  it("getFlow returns null when none attached", async () => {
    const f = await flowsRepo.getFlow("c_1");
    expect(f).toBeNull();
  });

  it("upsertFlow creates a new flow with the requested step list", async () => {
    const flow = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
    });
    expect(flow.conversationId).toBe("c_1");
    expect(flow.currentStepIndex).toBe(0);
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0]?.kind).toBe("user");
    expect(flow.steps[1]?.personaIds.sort()).toEqual(["p_a", "p_b"]);
  });

  it("upsertFlow replaces steps + cursor on second call", async () => {
    await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [{ kind: "user", personaIds: [] }],
    });
    const updated = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 1,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    expect(updated.currentStepIndex).toBe(1);
    expect(updated.steps).toHaveLength(2);
  });

  it("setStepIndex updates the cursor without rewriting steps", async () => {
    const f = await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    await flowsRepo.setStepIndex(f.id, 1);
    const reread = await flowsRepo.getFlow("c_1");
    expect(reread?.currentStepIndex).toBe(1);
    expect(reread?.steps).toHaveLength(2);
  });

  it("rejects an empty 'personas' step", async () => {
    await expect(
      flowsRepo.upsertFlow("c_1", {
        currentStepIndex: 0,
        steps: [{ kind: "personas", personaIds: [] }],
      }),
    ).rejects.toThrow();
  });

  it("rejects consecutive 'user' steps", async () => {
    await expect(
      flowsRepo.upsertFlow("c_1", {
        currentStepIndex: 0,
        steps: [
          { kind: "user", personaIds: [] },
          { kind: "user", personaIds: [] },
        ],
      }),
    ).rejects.toThrow();
  });

  it("CASCADE removes flow + steps when conversation is deleted", async () => {
    await flowsRepo.upsertFlow("c_1", {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
    });
    await sql.execute(`DELETE FROM conversations WHERE id = 'c_1'`);
    const flows = await sql.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM flows",
    );
    expect(flows[0]?.count).toBe(0);
  });
});
