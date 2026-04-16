// Provider aliases in the resolver — issue #41.
import { describe, it, expect } from "vitest";
import { resolveTargets } from "@/lib/personas/resolver";

describe("resolveTargets with provider aliases", () => {
  it("@openai resolves to the openai bare provider", () => {
    const r = resolveTargets({
      text: "@openai hi there",
      personas: [],
      selection: [],
    });
    expect(r.mode).toBe("targeted");
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0]?.provider).toBe("openai");
    expect(r.targets[0]?.personaId).toBeNull();
    expect(r.strippedText).toBe("hi there");
  });

  it("@anthropic resolves to the claude bare provider", () => {
    const r = resolveTargets({
      text: "@anthropic write me a haiku",
      personas: [],
      selection: [],
    });
    expect(r.targets[0]?.provider).toBe("claude");
  });

  it("@google resolves to gemini", () => {
    const r = resolveTargets({ text: "@google search this", personas: [], selection: [] });
    expect(r.targets[0]?.provider).toBe("gemini");
  });

  it("original prefix still works alongside alias", () => {
    const r = resolveTargets({ text: "@gpt hi", personas: [], selection: [] });
    expect(r.targets[0]?.provider).toBe("openai");
  });

  it("unknown prefix still reports unknown", () => {
    const r = resolveTargets({ text: "@nobody hi", personas: [], selection: [] });
    expect(r.unknown).toEqual(["nobody"]);
  });
});
