// Snapshot round-trip for persona.roleLens — slice 1 of #212 (#213).
//
// The on-disk snapshot keys lens entries by speaker *name* (not id) for
// portability across exports. Persona-id speakers are translated to
// names on export and back to fresh ids on import; the literal "user"
// key is preserved as "user".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { serializeSnapshot } from "@/lib/conversations/snapshot";
import { parseSnapshot } from "@/lib/schemas/snapshot";
import { importSnapshot } from "@/lib/conversations/snapshotImport";
import { createPersona } from "@/lib/personas/service";
import { listPersonas } from "@/lib/persistence/personas";
import * as convRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("snapshot round-trip preserves persona roleLens (#213)", () => {
  it("serializes lens entries keyed by persona name + the literal 'user'", async () => {
    const conv = await convRepo.createConversation({
      title: "Round trip",
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
    const alice = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    const bob = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    // Apply a lens to alice that flips bob and the human user to user-role.
    const { updatePersona } = await import("@/lib/personas/service");
    await updatePersona({
      id: alice.id,
      roleLens: { [bob.id]: "user", user: "user" },
    });
    const all = await listPersonas(conv.id);

    const json = serializeSnapshot(conv, all, []);
    const parsed = JSON.parse(json) as {
      personas: Array<{ name: string; roleLens?: Record<string, string> }>;
    };
    const aliceEntry = parsed.personas.find((p) => p.name === "Alice");
    expect(aliceEntry?.roleLens).toEqual({ Bob: "user", user: "user" });
  });

  it("import remaps name-keyed lens entries back to fresh persona ids", async () => {
    // Build a snapshot envelope by serializing then parsing through zod.
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
    const alice = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    const bob = await createPersona({
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    const { updatePersona } = await import("@/lib/personas/service");
    await updatePersona({
      id: alice.id,
      roleLens: { [bob.id]: "user", user: "user" },
    });
    const all = await listPersonas(conv.id);
    const json = serializeSnapshot(conv, all, []);
    const parsed = parseSnapshot(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await importSnapshot(parsed.snapshot);
    const importedPersonas = await listPersonas(result.conversation.id);
    const newAlice = importedPersonas.find((p) => p.name === "Alice");
    const newBob = importedPersonas.find((p) => p.name === "Bob");
    expect(newAlice).toBeDefined();
    expect(newBob).toBeDefined();
    // The lens has been remapped to the freshly-assigned ids.
    expect(newAlice!.roleLens).toEqual({ [newBob!.id]: "user", user: "user" });
    // And the new ids are NOT the same as the source ids (proves the
    // remap actually happened, not a coincidence of stable ids).
    expect(newAlice!.id).not.toBe(alice.id);
    expect(newBob!.id).not.toBe(bob.id);
  });

  it("handles a snapshot that omits roleLens entirely (back-compat)", async () => {
    // Older snapshots predate roleLens. Import must default to `{}`.
    const minimal = {
      version: 1 as const,
      title: "Old",
      systemPrompt: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
      compactionFloorIndex: null,
      selectedPersonas: [],
      personas: [
        {
          name: "Alice",
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
    };
    const parsed = parseSnapshot(JSON.stringify(minimal));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await importSnapshot(parsed.snapshot);
    const ps = await listPersonas(result.conversation.id);
    expect(ps[0]?.roleLens).toEqual({});
  });
});
