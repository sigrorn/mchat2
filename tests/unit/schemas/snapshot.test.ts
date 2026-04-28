// #165 — Schema for the snapshot envelope. Hard-fails on top-level
// shape errors (wrong version, not JSON, not an object, missing
// required fields) so the UI can show a clear "this isn't a chat
// snapshot" message.
import { describe, it, expect } from "vitest";
import { parseSnapshot } from "@/lib/schemas/snapshot";

const minimalSnapshot = {
  version: 1,
  title: "Test",
  systemPrompt: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitMarkIndex: null,
  limitSizeTokens: null,
  compactionFloorIndex: null,
  selectedPersonas: [],
  personas: [],
  messages: [],
};

describe("parseSnapshot (zod-backed, #165)", () => {
  it("returns ok:true on a minimal valid snapshot", () => {
    const result = parseSnapshot(JSON.stringify(minimalSnapshot));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.title).toBe("Test");
      expect(result.snapshot.personas).toEqual([]);
    }
  });

  it("returns ok:false on invalid JSON", () => {
    const result = parseSnapshot("xxx");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json/i);
  });

  it("returns ok:false on a top-level array", () => {
    const result = parseSnapshot(JSON.stringify([1, 2, 3]));
    expect(result.ok).toBe(false);
  });

  it("returns ok:false on wrong version", () => {
    const result = parseSnapshot(JSON.stringify({ ...minimalSnapshot, version: 99 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/version/i);
  });

  it("returns ok:false when title is missing", () => {
    const { title: _, ...rest } = minimalSnapshot;
    void _;
    const result = parseSnapshot(JSON.stringify(rest));
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when personas is missing", () => {
    const { personas: _, ...rest } = minimalSnapshot;
    void _;
    const result = parseSnapshot(JSON.stringify(rest));
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when messages is missing", () => {
    const { messages: _, ...rest } = minimalSnapshot;
    void _;
    const result = parseSnapshot(JSON.stringify(rest));
    expect(result.ok).toBe(false);
  });

  it("preserves a populated snapshot's personas + messages", () => {
    const populated = {
      ...minimalSnapshot,
      personas: [
        {
          name: "Alice",
          provider: "claude",
          systemPromptOverride: null,
          modelOverride: null,
          colorOverride: null,
          apertusProductId: null,
          visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
          runsAfter: [],
          sortOrder: 0,
          createdAtMessageIndex: 0,
        },
      ],
      messages: [
        {
          role: "user",
          content: "Hi",
          provider: null,
          model: null,
          persona: null,
          displayMode: "lines",
          pinned: false,
          pinTarget: null,
          addressedTo: ["Alice"],
          audience: [],
          index: 0,
          createdAt: 1000,
          errorMessage: null,
          errorTransient: false,
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
        },
      ],
    };
    const result = parseSnapshot(JSON.stringify(populated));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.personas).toHaveLength(1);
      expect(result.snapshot.messages).toHaveLength(1);
      expect(result.snapshot.messages[0]?.addressedTo).toEqual(["Alice"]);
    }
  });
});
