// +/- persona target modifiers — issue #96.
import { describe, it, expect } from "vitest";
import { parseTargetModifiers } from "@/lib/commands/targetModifier";

describe("parseTargetModifiers", () => {
  it("+alice → add alice", () => {
    expect(parseTargetModifiers("+alice")).toEqual({
      ok: true,
      ops: [{ action: "add", name: "alice" }],
    });
  });

  it("-bob → remove bob", () => {
    expect(parseTargetModifiers("-bob")).toEqual({
      ok: true,
      ops: [{ action: "remove", name: "bob" }],
    });
  });

  it("+alice -bob → multiple ops", () => {
    expect(parseTargetModifiers("+alice -bob")).toEqual({
      ok: true,
      ops: [
        { action: "add", name: "alice" },
        { action: "remove", name: "bob" },
      ],
    });
  });

  it("+alice +bob → multiple adds", () => {
    expect(parseTargetModifiers("+alice +bob")).toEqual({
      ok: true,
      ops: [
        { action: "add", name: "alice" },
        { action: "add", name: "bob" },
      ],
    });
  });

  it("returns not-ok for plain text", () => {
    expect(parseTargetModifiers("hello world").ok).toBe(false);
  });

  it("returns not-ok for @targeted messages", () => {
    expect(parseTargetModifiers("@alice hello").ok).toBe(false);
  });

  it("returns not-ok for // commands", () => {
    expect(parseTargetModifiers("//help").ok).toBe(false);
  });

  it("trims whitespace", () => {
    expect(parseTargetModifiers("  +alice  ")).toEqual({
      ok: true,
      ops: [{ action: "add", name: "alice" }],
    });
  });

  it("returns not-ok if any token lacks +/- prefix", () => {
    expect(parseTargetModifiers("+alice bob").ok).toBe(false);
  });
});
