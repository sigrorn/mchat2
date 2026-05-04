// conversation.flowMode round-trip through the repo (#223).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { createConversation, getConversation, updateConversation } from "@/lib/persistence/conversations";

let handle: TestDbHandle | null = null;
beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("conversation.flowMode (#223)", () => {
  it("defaults to false on create", async () => {
    const c = await createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    expect(c.flowMode).toBe(false);
    const reread = await getConversation(c.id);
    expect(reread?.flowMode).toBe(false);
  });

  it("round-trips flowMode=true", async () => {
    const c = await createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
      flowMode: true,
    });
    expect(c.flowMode).toBe(true);
    const reread = await getConversation(c.id);
    expect(reread?.flowMode).toBe(true);
  });

  it("update flips flowMode and persists", async () => {
    const c = await createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    await updateConversation({ ...c, flowMode: true });
    const reread = await getConversation(c.id);
    expect(reread?.flowMode).toBe(true);
    await updateConversation({ ...reread!, flowMode: false });
    const final = await getConversation(c.id);
    expect(final?.flowMode).toBe(false);
  });
});
