import { describe, it, expect } from "vitest";
import { resolveTargets } from "@/lib/personas/resolver";
import type { Persona } from "@/lib/types";

function persona(id: string, slug: string, provider: Persona["provider"] = "mock"): Persona {
  return {
    id,
    conversationId: "c_1",
    provider,
    name: slug,
    nameSlug: slug,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

const personas = [persona("p_alice", "alice"), persona("p_bob", "bob")];

describe("resolveTargets", () => {
  it("implicit uses current selection", () => {
    const r = resolveTargets({ text: "hello", personas, selection: ["p_alice"] });
    expect(r.mode).toBe("implicit");
    expect(r.targets.map((t) => t.key)).toEqual(["p_alice"]);
    expect(r.strippedText).toBe("hello");
  });

  it("targeted picks named personas and strips prefixes", () => {
    const r = resolveTargets({ text: "@alice @bob hi there", personas, selection: [] });
    expect(r.mode).toBe("targeted");
    expect(r.targets.map((t) => t.key)).toEqual(["p_alice", "p_bob"]);
    expect(r.strippedText).toBe("hi there");
  });

  it("@all expands to every active persona", () => {
    const r = resolveTargets({ text: "@all hi", personas, selection: [] });
    expect(r.mode).toBe("all");
    expect(r.targets.map((t) => t.key)).toEqual(["p_alice", "p_bob"]);
  });

  it("@others excludes current selection", () => {
    const r = resolveTargets({ text: "@others hi", personas, selection: ["p_alice"] });
    expect(r.mode).toBe("others");
    expect(r.targets.map((t) => t.key)).toEqual(["p_bob"]);
  });

  it("bare provider prefix falls through to bare target", () => {
    const r = resolveTargets({ text: "@claude hi", personas, selection: [] });
    expect(r.mode).toBe("targeted");
    expect(r.targets[0]).toMatchObject({ provider: "claude", personaId: null, key: "claude" });
  });

  it("unknown names are reported, not silently dropped", () => {
    const r = resolveTargets({ text: "@nobody hi", personas, selection: [] });
    expect(r.unknown).toEqual(["nobody"]);
    expect(r.targets).toEqual([]);
  });
});
