// #94 → #202 — Per-persona visibility defaults are normalized into
// the persona_visibility table at backfill time (#194), and
// rebuildVisibilityFromPersonaDefaults rewrites the table from the
// current per-persona defaults. The legacy in-memory helper
// buildMatrixFromDefaults was removed in #202; this suite tests the
// equivalent behavior through a real DB.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { createConversation, getConversation } from "@/lib/persistence/conversations";
import { createPersona } from "@/lib/persistence/personas";
import { rebuildVisibilityFromPersonaDefaults } from "@/lib/personas/visibilityRebuild";
import type { Conversation, Persona } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function freshConv(id = "c_1"): Promise<Conversation> {
  return createConversation({
    id,
    title: "t",
    systemPrompt: null,
    lastProvider: null,
    limitMarkIndex: null,
    displayMode: "lines",
    visibilityMode: "separated",
    visibilityMatrix: {},
    limitSizeTokens: null,
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

async function makePersona(
  conversationId: string,
  id: string,
  name: string,
  visibilityDefaults: Record<string, "y" | "n"> = {},
): Promise<Persona> {
  return createPersona({
    id,
    conversationId,
    provider: "mock",
    name,
    nameSlug: name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults,
    openaiCompatPreset: null, roleLens: {},
  });
}

describe("rebuildVisibilityFromPersonaDefaults", () => {
  it("returns empty matrix when no persona has 'n' defaults", async () => {
    handle = await createTestDb();
    const conv = await freshConv();
    await makePersona(conv.id, "p_a", "Alice");
    await makePersona(conv.id, "p_b", "Bob");
    const matrix = await rebuildVisibilityFromPersonaDefaults(conv.id);
    expect(matrix).toEqual({});
    const reloaded = await getConversation(conv.id);
    expect(reloaded?.visibilityMatrix).toEqual({});
  });

  it("language coach: sees all, seen by none", async () => {
    handle = await createTestDb();
    const conv = await freshConv();
    await makePersona(conv.id, "p_a", "Alice", { coach: "n" });
    await makePersona(conv.id, "p_b", "Bob", { coach: "n" });
    await makePersona(conv.id, "p_c", "Coach", { alice: "y", bob: "y" });
    const matrix = await rebuildVisibilityFromPersonaDefaults(conv.id);
    expect(matrix["p_a"]).toEqual(["p_b"]);
    expect(matrix["p_b"]).toEqual(["p_a"]);
    expect(matrix["p_c"]).toBeUndefined();
  });

  it("asymmetric: A sees B, B does not see A", async () => {
    handle = await createTestDb();
    const conv = await freshConv();
    await makePersona(conv.id, "p_a", "Alice", { bob: "y" });
    await makePersona(conv.id, "p_b", "Bob", { alice: "n" });
    const matrix = await rebuildVisibilityFromPersonaDefaults(conv.id);
    expect(matrix["p_a"]).toBeUndefined();
    expect(matrix["p_b"]).toEqual([]);
  });

  it("ignores unknown slugs in defaults", async () => {
    handle = await createTestDb();
    const conv = await freshConv();
    await makePersona(conv.id, "p_a", "Alice", { ghost: "n" });
    const matrix = await rebuildVisibilityFromPersonaDefaults(conv.id);
    // Alice has a 'n' entry on a non-existent slug; her row is empty
    // (no real source matches), but she still gets a row marker.
    // The persona_visibility table can't represent "n on unknown slug",
    // so the row is simply absent — full visibility.
    expect(matrix["p_a"]).toBeUndefined();
  });
});

describe("Conversation.visibilityMatrix is loaded from persona_visibility (#202)", () => {
  it("reflects the relational rows, not the JSON column", async () => {
    handle = await createTestDb();
    const conv = await freshConv();
    await makePersona(conv.id, "p_a", "Alice", { bob: "n" });
    await makePersona(conv.id, "p_b", "Bob");
    await rebuildVisibilityFromPersonaDefaults(conv.id);
    const reloaded = await getConversation(conv.id);
    expect(reloaded?.visibilityMatrix["p_a"]).toEqual([]);
  });
});
