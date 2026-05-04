// Snapshot round-trip preserves flow.loopStartIndex (#220).
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

describe("snapshot round-trip preserves flow.loopStartIndex (#220)", () => {
  it("serializes loopStartIndex alongside steps + cursor", async () => {
    const conv = await convRepo.createConversation({
      title: "Looped",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
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
    await flowsRepo.upsertFlow(conv.id, {
      currentStepIndex: 2,
      loopStartIndex: 2,
      steps: [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: [a.id] },
      ],
    });
    const ps = await listPersonas(conv.id);
    const flow = await flowsRepo.getFlow(conv.id);
    const json = serializeSnapshot(conv, ps, [], { flow });
    const parsed = JSON.parse(json) as {
      flow?: { currentStepIndex: number; loopStartIndex?: number };
    };
    expect(parsed.flow?.loopStartIndex).toBe(2);
  });

  it("import restores loopStartIndex", async () => {
    const conv = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
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
    await flowsRepo.upsertFlow(conv.id, {
      currentStepIndex: 0,
      loopStartIndex: 2,
      steps: [
        { kind: "user", personaIds: [] }, // setup
        { kind: "personas", personaIds: [a.id] }, // setup
        { kind: "user", personaIds: [] }, // ← loop start
        { kind: "personas", personaIds: [a.id] },
      ],
    });
    const ps = await listPersonas(conv.id);
    const flow = await flowsRepo.getFlow(conv.id);
    const json = serializeSnapshot(conv, ps, [], { flow });
    const parsed = parseSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await importSnapshot(parsed.snapshot);
    const newFlow = await flowsRepo.getFlow(result.conversation.id);
    expect(newFlow?.loopStartIndex).toBe(2);
  });

  it("legacy snapshot without loopStartIndex defaults to 0", async () => {
    // Pre-#220 snapshots don't carry the field.
    const legacy = {
      version: 1 as const,
      title: "Legacy",
      systemPrompt: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
      compactionFloorIndex: null,
      selectedPersonas: [],
      personas: [
        {
          name: "A",
          provider: "mock",
          systemPromptOverride: null,
          modelOverride: null,
          colorOverride: null,
          visibilityDefaults: {},
          sortOrder: 0,
          createdAtMessageIndex: 0,
        },
      ],
      messages: [],
      flow: {
        currentStepIndex: 0,
        steps: [
          { kind: "user" as const, personas: [] },
          { kind: "personas" as const, personas: ["A"] },
        ],
      },
    };
    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await importSnapshot(parsed.snapshot);
    const newFlow = await flowsRepo.getFlow(result.conversation.id);
    expect(newFlow?.loopStartIndex).toBe(0);
  });
});
