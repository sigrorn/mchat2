// Snapshot round-trip for conversation flows — slice 3 of #212 (#215).
//
// Flow definition is bundled alongside personas in the snapshot, with
// persona references keyed by name (not id). On import, names map back
// to fresh ids. Legacy snapshots without flow data import as-is —
// runs_after data is preserved untouched.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeSnapshot } from "@/lib/conversations/snapshot";
import { parseSnapshot } from "@/lib/schemas/snapshot";
import { importSnapshot } from "@/lib/conversations/snapshotImport";
import { createPersona } from "@/lib/personas/service";
import { listPersonas } from "@/lib/persistence/personas";
import * as convRepo from "@/lib/persistence/conversations";
import * as flowsRepo from "@/lib/persistence/flows";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("snapshot round-trip preserves conversation flow (#215)", () => {
  it("serializes flow steps with persona names + cursor index", async () => {
    const conv = await convRepo.createConversation({
      title: "Flowed",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    await flowsRepo.upsertFlow(conv.id, {
      currentStepIndex: 1,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id, b.id] },
      ],
    });
    const ps = await listPersonas(conv.id);

    const json = serializeSnapshot(conv, ps, [], { conversationId: conv.id });
    const parsed = JSON.parse(json) as {
      flow?: { currentStepIndex: number; steps: { kind: string; personas: string[] }[] };
    };
    expect(parsed.flow).toBeDefined();
    expect(parsed.flow?.currentStepIndex).toBe(1);
    expect(parsed.flow?.steps[0]?.kind).toBe("user");
    expect(parsed.flow?.steps[1]?.kind).toBe("personas");
    expect(parsed.flow?.steps[1]?.personas.sort()).toEqual(["Alice", "Bob"]);
  });

  it("import remaps persona-name keys back to fresh ids", async () => {
    const conv = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    const a = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    await flowsRepo.upsertFlow(conv.id, {
      currentStepIndex: 0,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id, b.id] },
      ],
    });
    const ps = await listPersonas(conv.id);
    const json = serializeSnapshot(conv, ps, [], { conversationId: conv.id });
    const parsed = parseSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await importSnapshot(parsed.snapshot);
    const newFlow = await flowsRepo.getFlow(result.conversation.id);
    expect(newFlow).not.toBeNull();
    const newPs = await listPersonas(result.conversation.id);
    const newA = newPs.find((p) => p.name === "Alice")!;
    const newB = newPs.find((p) => p.name === "Bob")!;
    expect(newFlow?.steps[1]?.personaIds.sort()).toEqual(
      [newA.id, newB.id].sort(),
    );
  });

  it("legacy snapshot without flow data imports without modification", async () => {
    // Import a snapshot that has runs_after but no flow definition.
    const legacy = {
      version: 1 as const,
      title: "Legacy",
      systemPrompt: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitMarkIndex: null,
      limitSizeTokens: null,
      compactionFloorIndex: null,
      selectedPersonas: [],
      personas: [
        {
          name: "A",
          provider: "mock",
          systemPromptOverride: null,
          modelOverride: null,
          colorOverride: null,
          apertusProductId: null,
          visibilityDefaults: {},
          runsAfter: [],
          sortOrder: 0,
          createdAtMessageIndex: 0,
        },
        {
          name: "B",
          provider: "mock",
          systemPromptOverride: null,
          modelOverride: null,
          colorOverride: null,
          apertusProductId: null,
          visibilityDefaults: {},
          runsAfter: ["A"],
          sortOrder: 1,
          createdAtMessageIndex: 0,
        },
      ],
      messages: [],
    };
    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await importSnapshot(parsed.snapshot);
    // No flow attached.
    const flow = await flowsRepo.getFlow(result.conversation.id);
    expect(flow).toBeNull();
    // runs_after on B was preserved.
    const ps = await listPersonas(result.conversation.id);
    const newA = ps.find((p) => p.name === "A")!;
    const newB = ps.find((p) => p.name === "B")!;
    expect(newB.runsAfter).toEqual([newA.id]);
  });
});
