// #66 — Multi-parent runsAfter validation in persona service.
// #200/#195: rewritten onto createTestDb so the persona repo's
// junction reads work correctly.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPersona, updatePersona } from "@/lib/personas/service";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("multi-parent runsAfter (#66)", () => {
  it("createPersona with multiple parents", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "B",
      currentMessageIndex: 0,
    });
    const c = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "C",
      currentMessageIndex: 0,
      runsAfter: [a.id, b.id],
    });
    expect(c.runsAfter.sort()).toEqual([a.id, b.id].sort());
  });

  it("detects cycles in multi-parent graph", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "B",
      currentMessageIndex: 0,
    });
    const c = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "C",
      currentMessageIndex: 0,
      runsAfter: [a.id, b.id],
    });
    // Trying to set A to depend on C would create: A → C → [A, B] cycle
    await expect(updatePersona({ id: a.id, runsAfter: [c.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });

  it("rejects self-parent in array", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await expect(updatePersona({ id: a.id, runsAfter: [a.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });

  it("rejects unknown parent in array", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await expect(updatePersona({ id: a.id, runsAfter: ["p_nonexistent"] })).rejects.toMatchObject({
      code: "unknown_parent",
    });
  });
});
