// #165 — Schemas for the JSON-encoded TEXT columns on conversations.
// Each schema must soft-fail (return a sane default) on malformed
// input so importing a backup written by an older version never
// blocks the user. Hard parse errors get a console warning so the
// drift is visible, but never throw.
import { describe, it, expect } from "vitest";
import {
  parseVisibilityMatrix,
  parseAutocompactThreshold,
  parseContextWarningsFired,
  parseSelectedPersonas,
} from "@/lib/schemas/conversationJsonColumns";

describe("parseVisibilityMatrix", () => {
  it("returns the parsed matrix on a valid object", () => {
    const json = JSON.stringify({ a: ["b", "c"], d: [] });
    expect(parseVisibilityMatrix(json)).toEqual({ a: ["b", "c"], d: [] });
  });

  it("drops keys whose value is not a string array", () => {
    const json = JSON.stringify({ ok: ["a"], bad: 5, alsoBad: [1, 2] });
    expect(parseVisibilityMatrix(json)).toEqual({ ok: ["a"] });
  });

  it("returns {} on invalid JSON", () => {
    expect(parseVisibilityMatrix("not json")).toEqual({});
  });

  it("returns {} on a top-level array", () => {
    expect(parseVisibilityMatrix(JSON.stringify([1, 2]))).toEqual({});
  });

  it("returns {} on null", () => {
    expect(parseVisibilityMatrix(JSON.stringify(null))).toEqual({});
  });
});

describe("parseAutocompactThreshold", () => {
  it("accepts kTokens with a positive value", () => {
    expect(parseAutocompactThreshold(JSON.stringify({ mode: "kTokens", value: 32 }))).toEqual({
      mode: "kTokens",
      value: 32,
    });
  });

  it("accepts percent with a positive value", () => {
    expect(parseAutocompactThreshold(JSON.stringify({ mode: "percent", value: 80 }))).toEqual({
      mode: "percent",
      value: 80,
    });
  });

  it("includes preserve when present and positive", () => {
    expect(
      parseAutocompactThreshold(JSON.stringify({ mode: "kTokens", value: 32, preserve: 3 })),
    ).toEqual({ mode: "kTokens", value: 32, preserve: 3 });
  });

  it("drops preserve when zero or negative", () => {
    expect(
      parseAutocompactThreshold(JSON.stringify({ mode: "kTokens", value: 32, preserve: 0 })),
    ).toEqual({ mode: "kTokens", value: 32 });
  });

  it("returns null on null input", () => {
    expect(parseAutocompactThreshold(null)).toBeNull();
  });

  it("returns null on unknown mode", () => {
    expect(parseAutocompactThreshold(JSON.stringify({ mode: "weird", value: 32 }))).toBeNull();
  });

  it("returns null on non-positive value", () => {
    expect(parseAutocompactThreshold(JSON.stringify({ mode: "kTokens", value: 0 }))).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    expect(parseAutocompactThreshold("not json")).toBeNull();
  });
});

describe("parseContextWarningsFired", () => {
  it("returns the parsed numbers", () => {
    expect(parseContextWarningsFired(JSON.stringify([80, 90]))).toEqual([80, 90]);
  });

  it("filters non-numeric entries", () => {
    expect(parseContextWarningsFired(JSON.stringify([80, "x", 90, null]))).toEqual([80, 90]);
  });

  it("returns [] on a non-array", () => {
    expect(parseContextWarningsFired(JSON.stringify({ x: 1 }))).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(parseContextWarningsFired("not json")).toEqual([]);
  });
});

describe("parseSelectedPersonas", () => {
  it("returns the parsed string array", () => {
    expect(parseSelectedPersonas(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("filters non-string entries", () => {
    expect(parseSelectedPersonas(JSON.stringify(["a", 1, null, "b"]))).toEqual(["a", "b"]);
  });

  it("returns [] on a non-array", () => {
    expect(parseSelectedPersonas(JSON.stringify({}))).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(parseSelectedPersonas("not json")).toEqual([]);
  });
});
