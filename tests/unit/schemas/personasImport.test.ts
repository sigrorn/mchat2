// #165 — Schema for imported persona files. Top-level malformed input
// (wrong version, missing personas array, not an object, not JSON)
// returns ok:false so the UI can show a meaningful error. Per-entry
// validation soft-fails: a single malformed persona is dropped from
// the list and the rest of the import proceeds, keeping a partial
// import usable.
import { describe, it, expect } from "vitest";
import { parsePersonasImport } from "@/lib/schemas/personasImport";

const validEntry = {
  name: "Alice",
  provider: "claude",
  systemPromptOverride: null,
  modelOverride: null,
  colorOverride: null,
  apertusProductId: null,
  visibilityDefaults: {}, openaiCompatPreset: null,
  runsAfter: [],
};

describe("parsePersonasImport (zod-backed, #165)", () => {
  it("returns ok:true on a valid file", () => {
    const json = JSON.stringify({ version: 1, personas: [validEntry] });
    const result = parsePersonasImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personas).toHaveLength(1);
      expect(result.personas[0]?.name).toBe("Alice");
      expect(result.skipped).toEqual([]);
    }
  });

  it("returns ok:false on invalid JSON", () => {
    const result = parsePersonasImport("not json");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when version is wrong", () => {
    const result = parsePersonasImport(JSON.stringify({ version: 99, personas: [] }));
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when personas is missing", () => {
    const result = parsePersonasImport(JSON.stringify({ version: 1 }));
    expect(result.ok).toBe(false);
  });

  it("soft-fails per-entry: drops malformed personas, keeps valid ones", () => {
    const json = JSON.stringify({
      version: 1,
      personas: [
        validEntry,
        { name: "BadProvider", provider: "not-a-real-provider" },
        { provider: "claude" }, // missing name
        { ...validEntry, name: "Carol" },
      ],
    });
    const result = parsePersonasImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const names = result.personas.map((p) => p.name);
      expect(names).toEqual(["Alice", "Carol"]);
      expect(result.skipped.length).toBe(2);
    }
  });

  it("normalizes optional string fields (empty string → null)", () => {
    const json = JSON.stringify({
      version: 1,
      personas: [{ ...validEntry, modelOverride: "" }],
    });
    const result = parsePersonasImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personas[0]?.modelOverride).toBeNull();
    }
  });

  it("filters non-string entries from runsAfter", () => {
    const json = JSON.stringify({
      version: 1,
      personas: [{ ...validEntry, runsAfter: ["bob", 5, null, "carol"] }],
    });
    const result = parsePersonasImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personas[0]?.runsAfter).toEqual(["bob", "carol"]);
    }
  });

  it("filters visibilityDefaults to only y/n values", () => {
    const json = JSON.stringify({
      version: 1,
      personas: [{ ...validEntry, visibilityDefaults: { a: "y", b: "x", c: "n" } }],
    });
    const result = parsePersonasImport(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.personas[0]?.visibilityDefaults).toEqual({ a: "y", c: "n" });
    }
  });
});
