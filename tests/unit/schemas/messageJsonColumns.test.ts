// #165 — Schemas for the JSON-encoded TEXT columns on messages
// (addressed_to, audience). Both are persona-key string arrays.
// Soft-fail rule: malformed input becomes [] so a single corrupt row
// never blocks listMessages from rendering the rest of the chat.
import { describe, it, expect } from "vitest";
import { parseAddressedTo, parseAudience } from "@/lib/schemas/messageJsonColumns";

describe("parseAddressedTo", () => {
  it("returns the parsed string array", () => {
    expect(parseAddressedTo(JSON.stringify(["alice", "bob"]))).toEqual(["alice", "bob"]);
  });

  it("filters non-string entries", () => {
    expect(parseAddressedTo(JSON.stringify(["a", 1, null, undefined]))).toEqual(["a"]);
  });

  it("returns [] on a non-array (object)", () => {
    expect(parseAddressedTo(JSON.stringify({ x: 1 }))).toEqual([]);
  });

  it("returns [] on null", () => {
    expect(parseAddressedTo(JSON.stringify(null))).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(parseAddressedTo("not json")).toEqual([]);
  });

  it("returns [] on empty string", () => {
    expect(parseAddressedTo("")).toEqual([]);
  });
});

describe("parseAudience", () => {
  it("returns the parsed string array", () => {
    expect(parseAudience(JSON.stringify(["alice"]))).toEqual(["alice"]);
  });

  it("filters non-string entries", () => {
    expect(parseAudience(JSON.stringify(["a", 1, "b"]))).toEqual(["a", "b"]);
  });

  it("returns [] on a non-array", () => {
    expect(parseAudience(JSON.stringify("alice"))).toEqual([]);
  });

  it("returns [] on invalid JSON", () => {
    expect(parseAudience("xxx")).toEqual([]);
  });
});
