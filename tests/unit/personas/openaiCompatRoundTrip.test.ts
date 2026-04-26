// #171 — round-trip a persona that points at an openai_compat preset
// through the real schema-applied DB (sql.js + production migrations).
// Catches regressions where the new column or JSON encoding drifts
// from what the persona service writes.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { createPersona, updatePersona } from "@/lib/personas/service";
import * as repo from "@/lib/persistence/personas";

let handle: TestDbHandle | null = null;

afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(): Promise<string> {
  await sql.execute(
    `INSERT INTO conversations
       (id, title, created_at, display_mode, visibility_mode,
        visibility_matrix, selected_personas, context_warnings_fired)
     VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
    ["c_oc", "openai-compat round-trip", 0],
  );
  return "c_oc";
}

describe("openai_compat persona round-trip (#171)", () => {
  it("persists a built-in preset reference and reads it back", async () => {
    handle = await createTestDb();
    const cid = await seedConversation();

    const created = await createPersona({
      conversationId: cid,
      provider: "openai_compat",
      name: "Routerly",
      currentMessageIndex: 0,
      openaiCompatPreset: { kind: "builtin", id: "openrouter" },
    });

    expect(created.openaiCompatPreset).toEqual({ kind: "builtin", id: "openrouter" });

    const reloaded = await repo.getPersona(created.id);
    expect(reloaded?.openaiCompatPreset).toEqual({ kind: "builtin", id: "openrouter" });
  });

  it("persists a custom preset reference (by name)", async () => {
    handle = await createTestDb();
    const cid = await seedConversation();

    const created = await createPersona({
      conversationId: cid,
      provider: "openai_compat",
      name: "Local",
      currentMessageIndex: 0,
      openaiCompatPreset: { kind: "custom", name: "my-vllm" },
    });
    const reloaded = await repo.getPersona(created.id);
    expect(reloaded?.openaiCompatPreset).toEqual({ kind: "custom", name: "my-vllm" });
  });

  it("native personas keep openaiCompatPreset null", async () => {
    handle = await createTestDb();
    const cid = await seedConversation();

    const created = await createPersona({
      conversationId: cid,
      provider: "claude",
      name: "Anthro",
      currentMessageIndex: 0,
    });
    expect(created.openaiCompatPreset).toBeNull();
    const reloaded = await repo.getPersona(created.id);
    expect(reloaded?.openaiCompatPreset).toBeNull();
  });

  it("update can change the preset reference (built-in → custom)", async () => {
    handle = await createTestDb();
    const cid = await seedConversation();

    const created = await createPersona({
      conversationId: cid,
      provider: "openai_compat",
      name: "Switcher",
      currentMessageIndex: 0,
      openaiCompatPreset: { kind: "builtin", id: "ionos" },
    });

    const updated = await updatePersona({
      id: created.id,
      openaiCompatPreset: { kind: "custom", name: "my-server" },
    });
    expect(updated.openaiCompatPreset).toEqual({ kind: "custom", name: "my-server" });
  });
});
